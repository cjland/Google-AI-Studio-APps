import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { getSql, hasDatabaseUrl } from './_lib/db';

function serializeError(error: unknown) {
  const err = error as any;

  return {
    name: typeof err?.name === 'string' ? err.name : null,
    message:
      typeof err?.message === 'string'
        ? err.message
        : String(error ?? 'Unknown error'),
    code: typeof err?.code === 'string' ? err.code : null,
    detail: typeof err?.detail === 'string' ? err.detail : null,
    hint: typeof err?.hint === 'string' ? err.hint : null,
    table: typeof err?.table === 'string' ? err.table : null,
    column: typeof err?.column === 'string' ? err.column : null,
    constraint:
      typeof err?.constraint === 'string' ? err.constraint : null,
    schema: typeof err?.schema === 'string' ? err.schema : null
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const requestId = randomUUID();

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({
      ok: false,
      error: 'Method Not Allowed',
      requestId
    });
  }

  const databaseUrlPresent = hasDatabaseUrl();
  const environment = {
    databaseUrlPresent,
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null
  };

  if (!databaseUrlPresent) {
    return res.status(200).json({
      ok: false,
      requestId,
      environment,
      error: 'DATABASE_URL is missing'
    });
  }

  let sql: any;
  try {
    sql = getSql();
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      requestId,
      environment,
      error: 'Failed to initialize database client',
      databaseError: serializeError(err)
    });
  }

  const systemInfo: any = {};
  const schemaInfo: any = {};
  const bootstrapStages: any = {};

  // 1. Connection check & System variables
  try {
    const connRes = await sql`SELECT 1 AS connected;`;
    systemInfo.connection = { ok: true, result: connRes };
  } catch (err: any) {
    systemInfo.connection = { ok: false, error: serializeError(err) };
  }

  try {
    const versionRes = await sql`SELECT version();`;
    systemInfo.postgresVersion = versionRes[0]?.version ?? 'Unknown';
  } catch (err: any) {
    systemInfo.postgresVersion = { error: serializeError(err) };
  }

  try {
    const dbNameRes = await sql`SELECT current_database();`;
    systemInfo.databaseName = dbNameRes[0]?.current_database ?? 'Unknown';
  } catch (err: any) {
    systemInfo.databaseName = { error: serializeError(err) };
  }

  try {
    const schemaRes = await sql`SELECT current_schema();`;
    systemInfo.currentSchema = schemaRes[0]?.current_schema ?? 'Unknown';
  } catch (err: any) {
    systemInfo.currentSchema = { error: serializeError(err) };
  }

  // 2. Discover tables in public schema
  try {
    const tablesRes = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `;
    schemaInfo.tablesInPublicSchema = tablesRes.map((t: any) => t.table_name);
  } catch (err: any) {
    schemaInfo.tablesInPublicSchema = { error: serializeError(err) };
  }

  // 3. Columns & Types
  try {
    const columnsRes = await sql`
      SELECT table_name, column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('bands', 'songs', 'gigs', 'gig_sets', 'set_songs') 
      ORDER BY table_name, ordinal_position;
    `;
    schemaInfo.columnsAndDataTypes = columnsRes;
  } catch (err: any) {
    schemaInfo.columnsAndDataTypes = { error: serializeError(err) };
  }

  // 4. Foreign key/ID column type check specifically requested
  try {
    const fkCheckRes = await sql`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND (
          (table_name = 'bands' AND column_name = 'id') OR 
          (table_name = 'songs' AND column_name IN ('id', 'band_id')) OR 
          (table_name = 'gigs' AND column_name IN ('id', 'band_id')) OR 
          (table_name = 'gig_sets' AND column_name IN ('id', 'gig_id')) OR 
          (table_name = 'set_songs' AND column_name IN ('id', 'set_id', 'song_id'))
        );
    `;
    schemaInfo.idColumnTypes = fkCheckRes;
  } catch (err: any) {
    schemaInfo.idColumnTypes = { error: serializeError(err) };
  }

  // 5. Row count check for each table
  const tables = ['bands', 'songs', 'gigs', 'gig_sets', 'set_songs'];
  schemaInfo.rowCounts = {};
  for (const table of tables) {
    try {
      const countRes = await sql.unsafe(`SELECT COUNT(*)::INTEGER AS count FROM ${table};`);
      schemaInfo.rowCounts[table] = { ok: true, count: countRes[0]?.count ?? 0 };
    } catch (err: any) {
      schemaInfo.rowCounts[table] = { ok: false, error: serializeError(err) };
    }
  }

  // 6. Bootstrap Independent Queries Diagnostics
  let resolvedBandId = '00000000-0000-0000-0000-000000000000'; // fallback
  let resolvedGigId = '00000000-0000-0000-0000-000000000000';  // fallback
  let resolvedSetId = '00000000-0000-0000-0000-000000000000';  // fallback

  // Stage: resolve-band
  try {
    const bandRows = await sql`
      SELECT id, name, created_at, updated_at 
      FROM bands 
      LIMIT 1;
    `;
    bootstrapStages['resolve-band'] = { ok: true, count: bandRows.length, rows: bandRows };
    if (bandRows.length > 0) {
      resolvedBandId = bandRows[0].id;
    }
  } catch (err: any) {
    bootstrapStages['resolve-band'] = { ok: false, error: serializeError(err) };
  }

  // Stage: load-songs
  try {
    const songRows = await sql`
      SELECT
        id,
        band_id,
        external_id,
        title,
        artist,
        duration_seconds,
        rating,
        status,
        video_url,
        guitar_url,
        bass_url,
        lyrics_url,
        notes,
        tags,
        google_sheet_row,
        source_updated_at,
        created_at,
        updated_at
      FROM songs
      WHERE band_id = ${resolvedBandId}
        AND LOWER(status) <> 'archived'
      ORDER BY
        LOWER(title),
        LOWER(COALESCE(artist, ''));
    `;
    bootstrapStages['load-songs'] = { ok: true, count: songRows.length };
  } catch (err: any) {
    bootstrapStages['load-songs'] = { ok: false, error: serializeError(err) };
  }

  // Stage: load-gigs
  try {
    const gigRows = await sql`
      SELECT
        g.id,
        g.band_id,
        g.name,
        g.location,
        g.gig_date,
        g.arrival_time,
        g.start_time,
        g.notes,
        g.status,
        g.created_at,
        g.updated_at,
        (
          SELECT COUNT(*)::INTEGER
          FROM gig_sets gs
          WHERE gs.gig_id = g.id
        ) AS set_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM set_songs ss
          JOIN gig_sets gs
            ON gs.id = ss.set_id
          WHERE gs.gig_id = g.id
        ) AS song_count,
        COALESCE(
          (
            SELECT SUM(COALESCE(s.duration_seconds, 0))::INTEGER
            FROM set_songs ss
            JOIN gig_sets gs
              ON gs.id = ss.set_id
            JOIN songs s
              ON s.id = ss.song_id
            WHERE gs.gig_id = g.id
          ),
          0
        ) AS total_duration_seconds
      FROM gigs g
      WHERE g.band_id = ${resolvedBandId};
    `;
    bootstrapStages['load-gigs'] = { ok: true, count: gigRows.length, rows: gigRows };
    if (gigRows.length > 0) {
      resolvedGigId = gigRows[0].id;
    }
  } catch (err: any) {
    bootstrapStages['load-gigs'] = { ok: false, error: serializeError(err) };
  }

  // Stage: load-sets
  try {
    const setRows = await sql`
      SELECT
        id,
        gig_id,
        name,
        set_number,
        status,
        target_duration_seconds,
        sort_order,
        created_at,
        updated_at
      FROM gig_sets
      WHERE gig_id = ${resolvedGigId}
      ORDER BY sort_order, set_number;
    `;
    bootstrapStages['load-sets'] = { ok: true, count: setRows.length, rows: setRows };
    if (setRows.length > 0) {
      resolvedSetId = setRows[0].id;
    }
  } catch (err: any) {
    bootstrapStages['load-sets'] = { ok: false, error: serializeError(err) };
  }

  // Stage: load-placements
  try {
    const placementRows = await sql`
      SELECT
        ss.id AS set_song_id,
        ss.set_id,
        ss.song_id,
        ss.position,
        ss.notes AS placement_notes,
        s.title,
        s.artist,
        s.duration_seconds,
        s.video_url,
        s.tags,
        s.rating,
        s.guitar_url,
        s.bass_url,
        s.lyrics_url,
        s.notes AS song_notes,
        s.status
      FROM set_songs ss
      JOIN songs s
        ON s.id = ss.song_id
      WHERE ss.set_id = ${resolvedSetId}
      ORDER BY ss.position ASC;
    `;
    bootstrapStages['load-placements'] = { ok: true, count: placementRows.length };
  } catch (err: any) {
    bootstrapStages['load-placements'] = { ok: false, error: serializeError(err) };
  }

  // Stage: load-usage
  try {
    const usageRows = await sql`
      SELECT 
        ss.song_id,
        ss.set_id,
        gs.set_number,
        gs.name AS set_name,
        COUNT(*)::int AS count
      FROM set_songs ss
      JOIN gig_sets gs ON ss.set_id = gs.id
      WHERE gs.gig_id = ${resolvedGigId}
      GROUP BY ss.song_id, ss.set_id, gs.set_number, gs.name
      ORDER BY gs.set_number ASC;
    `;
    bootstrapStages['load-usage'] = { ok: true, count: usageRows.length };
  } catch (err: any) {
    bootstrapStages['load-usage'] = { ok: false, error: serializeError(err) };
  }

  const ok = systemInfo.connection?.ok && 
             Object.values(schemaInfo.rowCounts).every((c: any) => c.ok) && 
             Object.values(bootstrapStages).every((c: any) => c.ok);

  return res.status(200).json({
    ok,
    requestId,
    environment,
    systemInfo,
    schemaInfo,
    bootstrapStages
  });
}
