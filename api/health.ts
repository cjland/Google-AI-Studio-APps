import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed', detail: 'Only GET requests are allowed on this endpoint' });
  }

  try {
    const result = await sql`SELECT NOW() AS database_time`;
    const databaseTime = result[0]?.database_time;
    return res.status(200).json({
      ok: true,
      database: 'connected',
      databaseTime
    });
  } catch (error: any) {
    console.error('Database health check failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal Server Error',
      detail: 'Failed to query database'
    });
  }
}
