import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';

import { neon } from '@neondatabase/serverless';

const VERSION = 'bootstrap-trace-v1';

type TraceStep = {
  step: string;
  ok: boolean;
  durationMs: number;
  rowCount?: number;
  data?: unknown;
  error?: Record<string, unknown>;
};

function safeText(value: unknown): string | null {
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
    err?.originalError
  ].filter(Boolean);

  function find(key: string): unknown {
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

  return {
    name: safeText(find('name')),
    message:
      safeText(find('message')) ||
      safeText(find('error')) ||
      safeText(error) ||
      'Unknown error',
    code: safeText(find('code')),
    detail: safeText(find('detail')),
    hint: safeText(find('hint')),
    schema: safeText(find('schema')),
    table: safeText(find('table')),
    column: safeText(find('column')),
    constraint: safeText(find('constraint')),
    position: safeText(find('position')),
    routine: safeText(find('routine')),
    stack:
      typeof err?.stack === 'string'
        ? err.stack
        : null,
    raw: safeText(error)
  };
}

async function trace(
  step: string,
  fn: () => Promise<any>
): Promise<TraceStep> {
  const started = Date.now();

  try {
    const data = await fn();

    return {
      step,
      ok: true,
      durationMs: Date.now() - started,
      rowCount: Array.isArray(data)
        ? data.length
        : undefined,
      data
    };
  } catch (error) {
    return {
      step,
      ok: false,
      durationMs: Date.now() - started,
      error: serializeError(error)
    };
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate'
  );

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      version: VERSION,
      error: 'Method not allowed'
    });
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return res.status(200).json({
      ok: false,
      version: VERSION,
      error: {
        message: 'DATABASE_URL is missing'
      }
    });
  }

  const sql = neon(databaseUrl);
  const steps: TraceStep[] = [];

  let bandId: string | null = null;
  let gigId: string | null = null;
  let setId: string | null = null;

  const connectionStep = await trace(
    '01-connect',
    async () => {
      return await sql`
        SELECT
          current_database() AS database,
          current_schema() AS schema,
          current_user AS database_user,
          NOW() AS database_time
      `;
    }
  );

  steps.push(connectionStep);

  const bandStep = await trace(
    '02-load-band-safe',
    async () => {
      return await sql`
        SELECT
          id,
          name,
          created_at,
          updated_at
        FROM public.bands
        ORDER BY created_at ASC
        LIMIT 1
      `;
    }
  );

  steps.push(bandStep);

  if (
    bandStep.ok &&
    Array.isArray(bandStep.data) &&
    bandStep.data.length > 0
  ) {
    bandId = String(bandStep.data[0].id);
  }

  steps.push(
    await trace(
      '03-test-band-optional-columns',
      async () => {
        return await sql`
          SELECT
            column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'bands'
            AND column_name IN (
              'members',
              'logo_url',
              'default_library_url',
              'band_profile_url',
              'gig_details_url'
            )
          ORDER BY column_name
        `;
      }
    )
  );

  steps.push(
    await trace(
      '04-load-songs-safe',
      async () => {
        if (!bandId) {
          return [];
        }

        return await sql`
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
          WHERE band_id = ${bandId}
          ORDER BY
            LOWER(title),
            LOWER(COALESCE(artist, ''))
        `;
      }
    )
  );

  steps.push(
    await trace(
      '05-empty-song-library-test',
      async () => {
        if (!bandId) {
          return {
            bandFound: false,
            songCount: 0
          };
        }

        const rows = await sql`
          SELECT COUNT(*)::int AS count
          FROM public.songs
          WHERE band_id = ${bandId}
        `;

        return {
          bandFound: true,
          songCount: rows[0]?.count ?? 0,
          emptyLibraryMustBeSupported:
            Number(rows[0]?.count ?? 0) === 0
        };
      }
    )
  );

  const gigStep = await trace(
    '06-load-gigs-safe',
    async () => {
      if (!bandId) {
        return [];
      }

      return await sql`
        SELECT
          id,
          band_id,
          name,
          venue,
          location,
          gig_date,
          arrival_time,
          start_time,
          notes,
          status,
          created_at,
          updated_at
        FROM public.gigs
        WHERE band_id = ${bandId}
        ORDER BY gig_date DESC NULLS LAST
      `;
    }
  );

  steps.push(gigStep);

  if (
    gigStep.ok &&
    Array.isArray(gigStep.data) &&
    gigStep.data.length > 0
  ) {
    gigId = String(gigStep.data[0].id);
  }

  const setStep = await trace(
    '07-load-sets-safe',
    async () => {
      if (!gigId) {
        return [];
      }

      return await sql`
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
        WHERE gig_id = ${gigId}
        ORDER BY
          sort_order ASC,
          set_number ASC
      `;
    }
  );

  steps.push(setStep);

  if (
    setStep.ok &&
    Array.isArray(setStep.data) &&
    setStep.data.length > 0
  ) {
    setId = String(setStep.data[0].id);
  }

  steps.push(
    await trace(
      '08-load-set-songs-safe',
      async () => {
        if (!setId) {
          return [];
        }

        return await sql`
          SELECT
            ss.id,
            ss.set_id,
            ss.song_id,
            ss.position,
            ss.notes,
            ss.created_at,
            ss.updated_at,
            s.title,
            s.artist,
            s.duration_seconds,
            s.status AS song_status,
            s.video_url,
            s.guitar_url,
            s.bass_url,
            s.lyrics_url,
            s.notes AS song_notes,
            s.tags,
            s.rating
          FROM public.set_songs ss
          INNER JOIN public.songs s
            ON s.id = ss.song_id
          WHERE ss.set_id = ${setId}
          ORDER BY ss.position ASC
        `;
      }
    )
  );

  steps.push(
    await trace(
      '09-check-known-column-mismatches',
      async () => {
        const expected = [
          ['bands', 'members'],
          ['bands', 'logo_url'],
          ['bands', 'default_library_url'],
          ['bands', 'band_profile_url'],
          ['bands', 'gig_details_url'],
          ['songs', 'played_live'],
          ['songs', 'general_notes'],
          ['songs', 'guitar_lesson_url'],
          ['songs', 'bass_lesson_url'],
          ['gig_sets', 'color'],
          ['gigs', 'arrive_time']
        ];

        const actualRows = await sql`
          SELECT
            table_name,
            column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
        `;

        const actual = new Set(
          actualRows.map(
            row =>
              `${row.table_name}.${row.column_name}`
          )
        );

        return expected.map(
          ([table, column]) => ({
            table,
            column,
            exists: actual.has(
              `${table}.${column}`
            )
          })
        );
      }
    )
  );

  steps.push(
    await trace(
      '10-json-serialization',
      async () => {
        const rows = await sql`
          SELECT
            b.id,
            b.name,
            COALESCE(
              (
                SELECT json_agg(s)
                FROM public.songs s
                WHERE s.band_id = b.id
              ),
              '[]'::json
            ) AS songs
          FROM public.bands b
          LIMIT 1
        `;

        JSON.stringify(rows);

        return rows;
      }
    )
  );

  const failedSteps = steps.filter(
    step => !step.ok
  );

  return res.status(200).json({
    ok: failedSteps.length === 0,
    version: VERSION,
    summary: {
      totalSteps: steps.length,
      passedSteps:
        steps.length - failedSteps.length,
      failedSteps: failedSteps.length,
      bandId,
      gigId,
      setId
    },
    steps
  });
}