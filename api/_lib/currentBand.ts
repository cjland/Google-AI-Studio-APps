import { getSql } from './db.js';
import { mapBand } from './mappers.js';

export async function getCurrentBand() {
  const sql = getSql();

  const rows = await sql`
    SELECT
      id,
      name,
      logo_url,
      members,
      created_at,
      updated_at
    FROM public.bands
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return null;
  }

  return mapBand(rows[0]);
}