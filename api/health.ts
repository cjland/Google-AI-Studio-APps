import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const requestId = randomUUID();

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      status: 'method-not-allowed',
      requestId,
      error: 'Method Not Allowed'
    });
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const environment =
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'unknown';

  const region = process.env.VERCEL_REGION ?? null;
  const deploymentId =
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
    null;

  if (!databaseUrl) {
    console.error('Database health check failed', {
      requestId,
      status: 'variable-missing',
      environment,
      region,
      deploymentId
    });

    return res.status(500).json({
      ok: false,
      status: 'variable-missing',
      databaseUrlPresent: false,
      database: 'not-tested',
      environment,
      region,
      deploymentId,
      requestId,
      error: 'DATABASE_URL is not available to this deployment.'
    });
  }

  try {
    const sql = neon(databaseUrl);

    const rows = await sql`
      SELECT NOW() AS database_time
    `;

    return res.status(200).json({
      ok: true,
      status: 'connected',
      databaseUrlPresent: true,
      database: 'connected',
      databaseTime: rows[0]?.database_time ?? null,
      environment,
      region,
      deploymentId,
      requestId
    });
  } catch (error: any) {
    console.error('Database health check failed', {
      requestId,
      status: 'connection-failed',
      environment,
      region,
      deploymentId,
      code: error?.code,
      message: error?.message
    });

    return res.status(500).json({
      ok: false,
      status: 'connection-failed',
      databaseUrlPresent: true,
      database: 'connection-failed',
      environment,
      region,
      deploymentId,
      requestId,
      code: error?.code ?? null,
      error: 'Unable to connect to Neon.'
    });
  }
}
