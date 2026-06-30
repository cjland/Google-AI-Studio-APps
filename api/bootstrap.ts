import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';

import { randomUUID } from 'node:crypto';
import { getSql } from './_lib/db';
import {
  mapSong,
  mapGig,
  mapGigSet,
  mapSetSongPlacement
} from './_lib/mappers';

const API_VERSION = 'bootstrap-diagnostic-v11';

function valueAsText(value: unknown): string | null {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeError(error: unknown) {
  const err = error as any;

  const sources = [
    err,
    err?.cause,
    err?.error,
    err?.data,
    err?.response,
    err?.response?.data,
    err?.originalError,
    err?.sourceError
  ].filter(Boolean);

  function findValue(key: string): unknown {
    for (const source of sources) {
      if (
        source &&
        typeof source === 'object' &&
        source[key] !== undefined &&
        source[key] !== null
      ) {
        return source[key];
      }
    }

    return null;
  }

  const messageValue =
    findValue('message') ??
    findValue('error') ??
    findValue('detail') ??
    error;

  return {
    name: valueAsText(findValue('name')),
    message:
      valueAsText(messageValue) ??
      'Unknown bootstrap error',
    code: valueAsText(findValue('code')),
    detail: valueAsText(findValue('detail')),
    hint: valueAsText(findValue('hint')),
    severity: valueAsText(findValue('severity')),
    schema: valueAsText(findValue('schema')),
    table: valueAsText(findValue('table')),
    column: valueAsText(findValue('column')),
    constraint: valueAsText(findValue('constraint')),
    position: valueAsText(findValue('position')),
    routine: valueAsText(findValue('routine')),
    where: valueAsText(findValue('where')),
    cause: valueAsText(err?.cause),
    stack:
      typeof err?.stack === 'string'
        ? err.stack
        : null,
    raw: valueAsText(error)
  };
}

function normalizeId(value: unknown): string {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value);
}

function normalizeDate(value: unknown): string {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  const text = String(value);

  if (text.includes('T')) {
    return text.split('T')[0];
  }

  return text;
}

function normalizeTime(value: unknown): string {
  if (!value) {
    return '';
  }

  const text = String(value);

  return text.length >= 5
    ? text.substring(0, 5)
    : text;
}

function createBandResponse(row: any) {
  return {
    id: normalizeId(row.id),
    name: row.name || 'Rock Em Sock Em',

    // These fields are not currently stored in Neon.
    // Return safe defaults instead of querying missing columns.
    members: [],
    logoUrl: null,
    defaultLibraryUrl: null,
    bandProfileUrl: null,
    gigDetailsUrl: null,

    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
  };
}

function sortGigs(gigs: any[]): any[] {
  const today = new Date()
    .toISOString()
    .split('T')[0];

  return [...gigs].sort((a, b) => {
    const dateA = normalizeDate(a.gigDate);
    const dateB = normalizeDate(b.gigDate);

    if (!dateA && !dateB) {
      return 0;
    }

    if (!dateA) {
      return 1;
    }

    if (!dateB) {
      return -1;
    }

    const upcomingA = dateA >= today;
    const upcomingB = dateB >= today;

    if (upcomingA && upcomingB) {
      return dateA.localeCompare(dateB);
    }

    if (!upcomingA && !upcomingB) {
      return dateB.localeCompare(dateA);
    }

    return upcomingA ? -1 : 1;
  });
}

function chooseActiveGig(
  gigs: any[],
  requestedGigId?: string
) {
  if (requestedGigId) {
    const requestedGig = gigs.find(
      gig =>
        normalizeId(gig.id) ===
        normalizeId(requestedGigId)
    );

    if (requestedGig) {
      return requestedGig;
    }
  }

  const today = new Date()
    .toISOString()
    .split('T')[0];

  const upcomingGig = gigs.find(gig => {
    const gigDate = normalizeDate(gig.gigDate);

    return gigDate && gigDate >= today;
  });

  if (upcomingGig) {
    return upcomingGig;
  }

  const byMostRecentlyUpdated = [...gigs].sort(
    (a, b) => {
      const timeA = a.updatedAt
        ? new Date(a.updatedAt).getTime()
        : 0;

      const timeB = b.updatedAt
        ? new Date(b.updatedAt).getTime()
        : 0;

      return timeB - timeA;
    }
  );

  return byMostRecentlyUpdated[0] ?? null;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const requestId = randomUUID();
  let stage = 'handler-start';

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );

  res.setHeader(
    'Pragma',
    'no-cache'
  );

  res.setHeader(
    'X-Setlist-API-Version',
    API_VERSION
  );

  res.setHeader(
    'X-Setlist-Request-ID',
    requestId
  );

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      apiVersion: API_VERSION,
      requestId,
      stage,
      error: 'Method Not Allowed',
      message: 'Only GET requests are supported.'
    });
  }

  if (
    req.query.debug === 'ping' ||
    req.query.ping === '1'
  ) {
    return res.status(200).json({
      ok: true,
      apiVersion: API_VERSION,
      requestId,
      stage,
      databaseUrlPresent:
        Boolean(process.env.DATABASE_URL),
      vercelEnvironment:
        process.env.VERCEL_ENV ?? null,
      vercelRegion:
        process.env.VERCEL_REGION ?? null,
      deploymentId:
        process.env.VERCEL_DEPLOYMENT_ID ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        null
    });
  }

  try {
    stage = 'create-neon-client';
    const sql = getSql();

    stage = 'test-database-connection';

    await sql`
      SELECT 1 AS connected
    `;

    /*
     * Do not call getCurrentBand() here.
     *
     * The previous getCurrentBand implementation may query optional
     * columns that do not exist in the actual Neon bands table.
     *
     * The real bands table contains:
     * id, name, created_at, updated_at
     */
    stage = 'load-band';

    const bandRows = await sql`
      SELECT
        id,
        name,
        created_at,
        updated_at
      FROM public.bands
      ORDER BY created_at ASC
      LIMIT 1
    `;

    if (bandRows.length === 0) {
      return res.status(200).json({
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        stage: 'complete-no-band',
        setupRequired: true,
        band: null,
        songs: [],
        gigs: [],
        activeGig: null,
        sets: [],
        usage: {}
      });
    }

    stage = 'map-band';

    const band = createBandResponse(
      bandRows[0]
    );

    stage = 'load-songs';

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
      FROM public.songs
      WHERE band_id = ${band.id}
        AND LOWER(
          COALESCE(status, 'active')
        ) <> 'archived'
      ORDER BY
        LOWER(COALESCE(title, '')),
        LOWER(COALESCE(artist, ''))
    `;

    stage = 'map-songs';

    const songs = songRows
      .map(row => mapSong(row))
      .filter(Boolean);

    stage = 'load-gigs';

    const gigRows = await sql`
      SELECT
        g.id,
        g.band_id,
        g.name,
        g.venue,
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
          FROM public.gig_sets gs
          WHERE gs.gig_id = g.id
        ) AS set_count,

        (
          SELECT COUNT(*)::INTEGER
          FROM public.set_songs ss
          INNER JOIN public.gig_sets gs
            ON gs.id = ss.set_id
          WHERE gs.gig_id = g.id
        ) AS song_count,

        COALESCE(
          (
            SELECT
              SUM(
                COALESCE(
                  s.duration_seconds,
                  0
                )
              )::INTEGER
            FROM public.set_songs ss
            INNER JOIN public.gig_sets gs
              ON gs.id = ss.set_id
            INNER JOIN public.songs s
              ON s.id = ss.song_id
            WHERE gs.gig_id = g.id
          ),
          0
        ) AS total_duration_seconds

      FROM public.gigs g
      WHERE g.band_id = ${band.id}
    `;

    stage = 'map-gigs';

    const mappedGigs = gigRows
      .map(row => {
        const mapped = mapGig(row);

        if (!mapped) {
          return null;
        }

        return {
          ...mapped,
          gigDate: normalizeDate(
            mapped.gigDate
          ),
          arriveTime: normalizeTime(
            mapped.arriveTime ??
            row.arrival_time
          ),
          startTime: normalizeTime(
            mapped.startTime ??
            row.start_time
          ),
          venue:
            row.venue ??
            null
        };
      })
      .filter(Boolean);

    stage = 'sort-gigs';

    const sortedGigs = sortGigs(
      mappedGigs
    );

    stage = 'resolve-active-gig';

    const requestedGigId =
      typeof req.query.gigId === 'string'
        ? req.query.gigId
        : undefined;

    const activeGig = chooseActiveGig(
      sortedGigs,
      requestedGigId
    );

    if (!activeGig) {
      return res.status(200).json({
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        stage: 'complete-no-active-gig',
        setupRequired: false,
        band,
        songs,
        gigs: sortedGigs,
        activeGig: null,
        sets: [],
        usage: {}
      });
    }

    stage = 'load-sets';

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
      FROM public.gig_sets
      WHERE gig_id = ${activeGig.id}
      ORDER BY
        sort_order ASC,
        set_number ASC
    `;

    stage = 'map-sets';

    const sets = setRows
      .map(row => mapGigSet(row))
      .filter(Boolean);

    stage = 'load-placements';

    const placementRows: any[] = [];

    for (const set of sets) {
      stage = `load-placements-set-${set.id}`;

      const rows = await sql`
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

        FROM public.set_songs ss

        INNER JOIN public.songs s
          ON s.id = ss.song_id

        WHERE ss.set_id = ${set.id}

        ORDER BY
          ss.position ASC,
          ss.id ASC
      `;

      placementRows.push(...rows);
    }

    stage = 'map-placements';

    const placements = placementRows
      .map(row =>
        mapSetSongPlacement(row)
      )
      .filter(Boolean);

    stage = 'load-usage';

    const usageRows = await sql`
      SELECT
        ss.song_id,
        ss.set_id,
        gs.set_number,
        gs.name AS set_name,
        COUNT(*)::INTEGER AS count

      FROM public.set_songs ss

      INNER JOIN public.gig_sets gs
        ON gs.id = ss.set_id

      WHERE gs.gig_id = ${activeGig.id}

      GROUP BY
        ss.song_id,
        ss.set_id,
        gs.set_number,
        gs.name

      ORDER BY
        gs.set_number ASC,
        gs.name ASC
    `;

    stage = 'build-usage';

    const usage: Record<
      string,
      Array<{
        setId: string;
        setNumber: number;
        setName: string;
        count: number;
      }>
    > = {};

    for (const row of usageRows) {
      const songId = normalizeId(
        row.song_id
      );

      if (!songId) {
        continue;
      }

      if (!usage[songId]) {
        usage[songId] = [];
      }

      usage[songId].push({
        setId: normalizeId(
          row.set_id
        ),
        setNumber: Number(
          row.set_number ?? 0
        ),
        setName: String(
          row.set_name ?? ''
        ),
        count: Number(
          row.count ?? 0
        )
      });
    }

    stage = 'build-sets-with-songs';

    const setsWithSongs = sets.map(set => {
      const setId = normalizeId(set.id);

      const setPlacements = placements
        .filter(placement => {
          return (
            normalizeId(
              placement.setId
            ) === setId
          );
        })
        .sort((a, b) => {
          return (
            Number(a.position ?? 0) -
            Number(b.position ?? 0)
          );
        });

      return {
        ...set,
        songs: setPlacements
      };
    });

    stage = 'build-response';

    return res.status(200).json({
      ok: true,
      apiVersion: API_VERSION,
      requestId,
      stage: 'complete',
      setupRequired: false,
      band,
      songs,
      gigs: sortedGigs,
      activeGig,
      sets: setsWithSongs,
      usage,
      diagnostics: {
        bandCount: bandRows.length,
        songCount: songs.length,
        gigCount: sortedGigs.length,
        setCount: setsWithSongs.length,
        placementCount: placements.length,
        usageSongCount:
          Object.keys(usage).length
      }
    });
  } catch (error: unknown) {
    const databaseError =
      serializeError(error);

    console.error(
      'BOOTSTRAP_FAILURE',
      {
        apiVersion: API_VERSION,
        requestId,
        stage,
        databaseError
      }
    );

    return res.status(500).json({
      ok: false,
      apiVersion: API_VERSION,
      requestId,
      stage,
      error:
        'The bootstrap request failed.',
      message:
        databaseError.message,
      detail:
        databaseError.detail ??
        databaseError.raw ??
        'No additional error detail was returned.',
      code:
        databaseError.code,
      hint:
        databaseError.hint,
      severity:
        databaseError.severity,
      databaseSchema:
        databaseError.schema,
      databaseTable:
        databaseError.table,
      databaseColumn:
        databaseError.column,
      databaseConstraint:
        databaseError.constraint,
      databasePosition:
        databaseError.position,
      databaseRoutine:
        databaseError.routine,
      databaseWhere:
        databaseError.where,
      databaseError
    });
  }
}