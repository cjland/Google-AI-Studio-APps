import type { VercelRequest, VercelResponse } from '@vercel/node';


import { getSql, ensureSchema } from './_lib/db.js';


import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow POST and GET for ease of testing
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).json({ error: 'Method Not Allowed', detail: 'Only POST or GET requests are allowed on this endpoint' });
  }

  try {
    // Ensure all tables are created
    await ensureSchema();
    const sql = getSql();
    // 1. Find or create the first band
    const existingBands = await sql`
      SELECT id, name, created_at, updated_at
      FROM bands
      ORDER BY created_at ASC
      LIMIT 1
    `;

    let band;
    if (existingBands.length > 0) {
      band = existingBands[0];
    } else {
      const insertedBands = await sql`
        INSERT INTO bands (name)
        VALUES ('Rock Em Sock Em')
        RETURNING id, name, created_at, updated_at
      `;
      band = insertedBands[0];
    }

    // 2. Find or create the first gig for that band
    const existingGigs = await sql`
      SELECT id, name, location, gig_date, start_time, arrival_time, notes, status
      FROM gigs
      WHERE band_id = ${band.id}
      LIMIT 1
    `;

    let gig;
    if (existingGigs.length > 0) {
      gig = existingGigs[0];
    } else {
      const newGigId = uuidv4();
      const todayStr = new Date().toISOString().split('T')[0];
      const insertedGigs = await sql`
        INSERT INTO gigs (
          id, band_id, name, location, gig_date, start_time, arrival_time, notes, status, updated_at
        ) VALUES (
          ${newGigId}, ${band.id}, 'Initial Gig', 'Local Venue', ${todayStr}, '19:00', '18:00', 'Auto-created during setup', 'draft', NOW()
        ) RETURNING id, name, location, gig_date, start_time, arrival_time, notes, status
      `;
      gig = insertedGigs[0];
    }

    // 3. Find or create the first set for that gig
    const existingSets = await sql`
      SELECT id, gig_id, name, set_number, sort_order, status, target_duration_seconds
      FROM gig_sets
      WHERE gig_id = ${gig.id}
      LIMIT 1
    `;

    let set;
    if (existingSets.length > 0) {
      set = existingSets[0];
    } else {
      const newSetId = uuidv4();
      const insertedSets = await sql`
        INSERT INTO gig_sets (
          id, gig_id, name, set_number, sort_order, status, target_duration_seconds, updated_at
        ) VALUES (
          ${newSetId}, ${gig.id}, 'Set 1', 1, 1, 'draft', NULL, NOW()
        ) RETURNING id, gig_id, name, set_number, sort_order, status
      `;
      set = insertedSets[0];
    }

    return res.status(200).json({
      success: true,
      band,
      gig,
      set
    });

  } catch (error: any) {
    console.error('Setup failed:', error);
    return res.status(500).json({
      error: 'Setup Failed',
      code: error.code || 'UNKNOWN_CODE',
      detail: error.message || 'An error occurred during DB initialization'
    });
  }
}
