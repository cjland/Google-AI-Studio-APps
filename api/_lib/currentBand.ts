import { getSql } from './db';
import { mapBand } from './mappers';

export async function getCurrentBand() {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, created_at, updated_at
    FROM bands
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return null;
  }
  return mapBand(rows[0]);
}
