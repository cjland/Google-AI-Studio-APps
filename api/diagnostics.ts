import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { getSql, hasDatabaseUrl, ensureSchema } from './_lib/db';

interface DiagnosticCheck {
  ok: boolean;
  count?: number;
  code?: string | null;
  message?: string | null;
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

  const checks: {
    connection: DiagnosticCheck;
    bands: DiagnosticCheck;
    songs: DiagnosticCheck;
    gigs: DiagnosticCheck;
    gigSets: DiagnosticCheck;
    setSongs: DiagnosticCheck;
  } = {
    connection: { ok: false },
    bands: { ok: false },
    songs: { ok: false },
    gigs: { ok: false },
    gigSets: { ok: false },
    setSongs: { ok: false }
  };

  if (!databaseUrlPresent) {
    const missingMsg = 'DATABASE_URL is missing';
    checks.connection = { ok: false, code: 'DATABASE_URL_MISSING', message: missingMsg };
    checks.bands = { ok: false, code: 'DATABASE_URL_MISSING', message: missingMsg };
    checks.songs = { ok: false, code: 'DATABASE_URL_MISSING', message: missingMsg };
    checks.gigs = { ok: false, code: 'DATABASE_URL_MISSING', message: missingMsg };
    checks.gigSets = { ok: false, code: 'DATABASE_URL_MISSING', message: missingMsg };
    checks.setSongs = { ok: false, code: 'DATABASE_URL_MISSING', message: missingMsg };

    return res.status(200).json({
      ok: false,
      requestId,
      environment,
      checks
    });
  }

  let sql;
  try {
    sql = getSql();
    await ensureSchema();
  } catch (err: any) {
    const msg = err?.message ?? 'Failed to initialize database client or create schema';
    checks.connection = { ok: false, code: err?.code ?? 'INIT_FAILED', message: msg };
    return res.status(200).json({
      ok: false,
      requestId,
      environment,
      checks
    });
  }

  // 1. Connection check
  try {
    const result = await sql`SELECT 1 AS connected;`;
    if (result && result.length > 0) {
      checks.connection = { ok: true };
    } else {
      checks.connection = { ok: false, message: 'No result returned from SELECT 1' };
    }
  } catch (err: any) {
    checks.connection = { ok: false, code: err?.code ?? 'QUERY_FAILED', message: err?.message };
  }

  // Helper helper to run queries safely
  const runQuery = async (queryStr: string): Promise<DiagnosticCheck> => {
    try {
      const res = await sql.unsafe(queryStr);
      const count = res[0]?.count !== undefined ? Number(res[0].count) : undefined;
      return { ok: true, count };
    } catch (err: any) {
      return { ok: false, code: err?.code ?? 'QUERY_FAILED', message: err?.message };
    }
  };

  // Run subsequent checks ONLY if connection query didn't throw a terminal driver error or if we have client
  checks.bands = await runQuery('SELECT COUNT(*)::INTEGER AS count FROM bands;');
  checks.songs = await runQuery('SELECT COUNT(*)::INTEGER AS count FROM songs;');
  checks.gigs = await runQuery('SELECT COUNT(*)::INTEGER AS count FROM gigs;');
  checks.gigSets = await runQuery('SELECT COUNT(*)::INTEGER AS count FROM gig_sets;');
  checks.setSongs = await runQuery('SELECT COUNT(*)::INTEGER AS count FROM set_songs;');

  const ok = Object.values(checks).every((c) => c.ok);

  return res.status(200).json({
    ok,
    requestId,
    environment,
    checks
  });
}
