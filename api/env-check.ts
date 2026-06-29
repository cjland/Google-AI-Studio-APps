import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { hasDatabaseUrl } from './_lib/db';

export default function handler(
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

  return res.status(200).json({
    ok: true,
    databaseUrlPresent: hasDatabaseUrl(),
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    nodeEnvironment: process.env.NODE_ENV ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    requestId
  });
}
