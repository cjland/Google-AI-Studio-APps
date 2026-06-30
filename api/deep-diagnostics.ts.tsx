import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';

import { neon } from '@neondatabase/serverless';

const DIAGNOSTIC_VERSION = 'deep-diagnostics-v1';

type DiagnosticResult = {
  test: string;
  ok: boolean;
  durationMs: number;
  data?: unknown;
  error?: Record<string, unknown>;
};

function textValue(value: unknown): string | null {
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
    err?.originalError,
    err?.sourceError,
    err?.response,
    err?.response?.data,
    err?.data
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
    name: textValue(find('name')),
    message:
      textValue(find('message')) ??
      textValue(find('error')) ??
      textValue(error) ??
      'Unknown error',
    code: textValue(find('code')),
    detail: textValue(find('detail')),
    hint: textValue(find('hint')),
    severity: textValue(find('severity')),
    schema: textValue(find('schema')),
    table: textValue(find('table')),
    column: textValue(find('column')),
    constraint: textValue(find('constraint')),
    position: textValue(find('position')),
    routine: textValue(find('routine')),
    where: textValue(find('where')),
    cause: textValue(err?.cause),
    stack:
      typeof err?.stack === 'string'
        ? err.stack
        : null,
    raw: textValue(error)
  };
}

async function runTest(
  test: string,
  fn: () => Promise<unknown>
): Promise<DiagnosticResult> {
  const started = Date.now();

  try {
    const data = await fn();

    return {
      test,
      ok: true,
      durationMs: Date.now() - started,
      data
    };
  } catch (error) {
    return {
      test,
      ok: false,
      durationMs: Date.now() - started,
      error: serializeError(error)
    };
  }
}

function maskConnectionString(
  connectionString: string | undefined
) {
  if (!connectionString) {
    return null;
  }

  try {
    const parsed = new URL(connectionString);

    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || null,
      database: parsed.pathname.replace(/^\//, ''),
      usernamePresent: Boolean(parsed.username),
      passwordPresent: Boolean(parsed.password),
      sslmode: parsed.searchParams.get('sslmode'),
      channelBinding:
        parsed.searchParams.get('channel_binding'),
      pooledHostname:
        parsed.hostname.includes('-pooler'),
      queryParameterNames: Array.from(
        parsed.searchParams.keys()
      )
    };
  } catch (error) {
    return {
      parseFailed: true,
      length: connectionString.length,
      startsWithPostgres:
        connectionString.startsWith('postgres://') ||
        connectionString.startsWith('postgresql://')
    };
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startedAt = new Date().toISOString();

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );

  res.setHeader(
    'X-Setlist-Diagnostic-Version',
    DIAGNOSTIC_VERSION
  );

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      diagnosticVersion: DIAGNOSTIC_VERSION,
      error: 'Method not allowed'
    });
  }

  const databaseUrl = process.env.DATABASE_URL;

  const response: {
    ok: boolean;
    diagnosticVersion: string;
    startedAt: string;
    environment: Record<string, unknown>;
    connectionString: unknown;
    tests: DiagnosticResult[];
  } = {
    ok: false,
    diagnosticVersion: DIAGNOSTIC_VERSION,
    startedAt,
    environment: {
      nodeVersion: process.version,
      vercel: Boolean(process.env.VERCEL),
      vercelEnv: process.env.VERCEL_ENV ?? null,
      vercelRegion: process.env.VERCEL_REGION ?? null,
      vercelUrl: process.env.VERCEL_URL ?? null,
      productionUrl:
        process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      gitCommitSha:
        process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitCommitRef:
        process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deploymentId:
        process.env.VERCEL_DEPLOYMENT_ID ?? null,
      databaseUrlPresent: Boolean(databaseUrl),
      databaseUrlLength: databaseUrl?.length ?? 0
    },
    connectionString: maskConnectionString(databaseUrl),
    tests: []
  };

  if (!databaseUrl) {
    response.tests.push({
      test: 'database-url-present',
      ok: false,
      durationMs: 0,
      error: {
        message:
          'DATABASE_URL is missing from this Vercel environment.'
      }
    });

    return res.status(200).json(response);
  }

  let sql: ReturnType<typeof neon>;

  try {
    sql = neon(databaseUrl);
  } catch (error) {
    response.tests.push({
      test: 'create-neon-client',
      ok: false,
      durationMs: 0,
      error: serializeError(error)
    });

    return res.status(200).json(response);
  }

  response.tests.push(
    await runTest(
      'basic-select',
      async () => {
        const rows = await sql`
          SELECT
            1 AS value,
            NOW() AS database_time
        `;

        return rows;
      }
    )
  );

  response.tests.push(
    await runTest(
      'database-identity',
      async () => {
        const rows = await sql`
          SELECT
            current_database() AS database_name,
            current_user AS database_user,
            current_schema() AS current_schema,
            current_setting('search_path') AS search_path,
            version() AS postgres_version
        `;

        return rows;
      }
    )
  );

  response.tests.push(
    await runTest(
      'visible-schemas',
      async () => {
        return await sql`
          SELECT schema_name
          FROM information_schema.schemata
          ORDER BY schema_name
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'public-tables',
      async () => {
        return await sql`
          SELECT
            table_schema,
            table_name,
            table_type
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'expected-table-existence',
      async () => {
        return await sql`
          SELECT
            expected.table_name,
            to_regclass(
              'public.' || expected.table_name
            ) AS resolved_relation
          FROM (
            VALUES
              ('bands'),
              ('songs'),
              ('gigs'),
              ('gig_sets'),
              ('set_songs')
          ) AS expected(table_name)
          ORDER BY expected.table_name
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'expected-columns',
      async () => {
        return await sql`
          SELECT
            table_name,
            column_name,
            data_type,
            udt_name,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN (
              'bands',
              'songs',
              'gigs',
              'gig_sets',
              'set_songs'
            )
          ORDER BY
            table_name,
            ordinal_position
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bands-count',
      async () => {
        return await sql`
          SELECT COUNT(*)::int AS count
          FROM public.bands
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bands-sample',
      async () => {
        return await sql`
          SELECT *
          FROM public.bands
          LIMIT 3
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'songs-count',
      async () => {
        return await sql`
          SELECT COUNT(*)::int AS count
          FROM public.songs
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'songs-sample',
      async () => {
        return await sql`
          SELECT *
          FROM public.songs
          LIMIT 3
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'gigs-count',
      async () => {
        return await sql`
          SELECT COUNT(*)::int AS count
          FROM public.gigs
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'gigs-sample',
      async () => {
        return await sql`
          SELECT *
          FROM public.gigs
          LIMIT 3
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'gig-sets-count',
      async () => {
        return await sql`
          SELECT COUNT(*)::int AS count
          FROM public.gig_sets
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'set-songs-count',
      async () => {
        return await sql`
          SELECT COUNT(*)::int AS count
          FROM public.set_songs
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'foreign-key-types',
      async () => {
        return await sql`
          SELECT
            table_name,
            column_name,
            data_type,
            udt_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'bands'
                AND column_name = 'id')
              OR
              (table_name = 'songs'
                AND column_name IN ('id', 'band_id'))
              OR
              (table_name = 'gigs'
                AND column_name IN ('id', 'band_id'))
              OR
              (table_name = 'gig_sets'
                AND column_name IN ('id', 'gig_id'))
              OR
              (table_name = 'set_songs'
                AND column_name IN (
                  'id',
                  'set_id',
                  'song_id'
                ))
            )
          ORDER BY
            table_name,
            column_name
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'foreign-key-constraints',
      async () => {
        return await sql`
          SELECT
            tc.constraint_name,
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.constraint_schema =
                kcu.constraint_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name =
                tc.constraint_name
            AND ccu.constraint_schema =
                tc.constraint_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
          ORDER BY
            tc.table_name,
            tc.constraint_name
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bootstrap-band-query',
      async () => {
        return await sql`
          SELECT *
          FROM public.bands
          ORDER BY created_at ASC NULLS LAST
          LIMIT 1
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bootstrap-band-id',
      async () => {
        return await sql`
          SELECT
            id,
            pg_typeof(id)::text AS id_type
          FROM public.bands
          LIMIT 1
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bootstrap-songs-query',
      async () => {
        return await sql`
          SELECT s.*
          FROM public.songs s
          JOIN public.bands b
            ON b.id = s.band_id
          LIMIT 10
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bootstrap-gigs-query',
      async () => {
        return await sql`
          SELECT g.*
          FROM public.gigs g
          JOIN public.bands b
            ON b.id = g.band_id
          LIMIT 10
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bootstrap-sets-query',
      async () => {
        return await sql`
          SELECT gs.*
          FROM public.gig_sets gs
          JOIN public.gigs g
            ON g.id = gs.gig_id
          LIMIT 10
        `;
      }
    )
  );

  response.tests.push(
    await runTest(
      'bootstrap-placements-query',
      async () => {
        return await sql`
          SELECT
            ss.*,
            s.title,
            s.artist
          FROM public.set_songs ss
          JOIN public.songs s
            ON s.id = ss.song_id
          JOIN public.gig_sets gs
            ON gs.id = ss.set_id
          LIMIT 10
        `;
      }
    )
  );

  response.ok = response.tests.every(
    test => test.ok
  );

  return res.status(200).json(response);
}