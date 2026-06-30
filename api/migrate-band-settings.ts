import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';

import { getSql } from './_lib/db.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (
    req.method !== 'POST' &&
    req.method !== 'GET'
  ) {
    res.setHeader('Allow', 'GET, POST');

    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  try {
    const sql = getSql();

    await sql`
      ALTER TABLE public.bands
      ADD COLUMN IF NOT EXISTS
        logo_url text
    `;

    await sql`
      ALTER TABLE public.bands
      ADD COLUMN IF NOT EXISTS
        members text[] NOT NULL DEFAULT '{}'
    `;

    await sql`
      ALTER TABLE public.bands
      ADD COLUMN IF NOT EXISTS
        default_library_url text
    `;

    await sql`
      ALTER TABLE public.bands
      ADD COLUMN IF NOT EXISTS
        band_profile_url text
    `;

    await sql`
      ALTER TABLE public.bands
      ADD COLUMN IF NOT EXISTS
        gig_details_url text
    `;

    const columns = await sql`
      SELECT
        column_name,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bands'
      ORDER BY ordinal_position
    `;

    return res.status(200).json({
      ok: true,
      message:
        'Band settings columns are ready.',
      columns
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message:
        error?.message ||
        'Band settings migration failed.',
      code: error?.code || null,
      detail: error?.detail || null
    });
  }
}
