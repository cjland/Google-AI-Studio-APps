import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentBand } from './_lib/currentBand';
import { mapGig, mapGigSet } from './_lib/mappers';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = req.method;
  const client = await pool.connect();

  try {
    const band = await getCurrentBand();
    if (!band) {
      return res.status(200).json({
        setupRequired: true,
        gigs: []
      });
    }

    // --- GET ALL GIGS ---
    if (method === 'GET') {
      const gRes = await client.query(
        `SELECT g.*,
          (SELECT COUNT(*)::int FROM gig_sets s WHERE s.gig_id = g.id) AS set_count,
          (SELECT COUNT(*)::int FROM set_songs ss WHERE ss.set_id IN (SELECT id FROM gig_sets s WHERE s.gig_id = g.id)) AS song_count,
          COALESCE(
            (SELECT SUM(so.duration_seconds)::int 
             FROM set_songs ss 
             JOIN songs so ON ss.song_id = so.id 
             WHERE ss.set_id IN (SELECT id FROM gig_sets s WHERE s.gig_id = g.id)), 
            0
          ) AS total_duration_seconds
        FROM gigs g
        WHERE g.band_id = $1`,
        [band.id]
      );
      const gigs = gRes.rows.map(mapGig);

      // Order by: upcoming ascending, past descending, null last
      const nowStr = new Date().toISOString().split('T')[0];
      const sortedGigs = gigs.sort((a, b) => {
        const dateA = a.gigDate;
        const dateB = b.gigDate;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        const isUpcomingA = dateA >= nowStr;
        const isUpcomingB = dateB >= nowStr;

        if (isUpcomingA && isUpcomingB) {
          return dateA.localeCompare(dateB);
        }
        if (!isUpcomingA && !isUpcomingB) {
          return dateB.localeCompare(dateA);
        }

        return isUpcomingA ? -1 : 1;
      });

      return res.status(200).json(sortedGigs);
    }

    // --- POST NEW GIG ---
    if (method === 'POST') {
      const { name, location, gigDate, startTime, arriveTime, notes, status } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Bad Request', detail: 'Gig name is required' });
      }

      await client.query('BEGIN');

      const newGigId = uuidv4();
      const gigRes = await client.query(
        `INSERT INTO gigs (
          id, band_id, name, location, gig_date, start_time, arrival_time, notes, status, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
        ) RETURNING *`,
        [
          newGigId,
          band.id,
          name.trim(),
          location || '',
          gigDate || null,
          startTime || '',
          arriveTime || '',
          notes || '',
          status || 'Draft'
        ]
      );

      // Automatically create one initial empty set: Set 1
      const newSetId = uuidv4();
      const setRes = await client.query(
        `INSERT INTO gig_sets (
          id, gig_id, name, set_number, sort_order, status, target_duration_seconds, updated_at
        ) VALUES (
          $1, $2, $3, 1, 1, 'Draft', NULL, NOW()
        ) RETURNING *`,
        [newSetId, newGigId, 'Set 1']
      );

      await client.query('COMMIT');

      const createdGig = mapGig(gigRes.rows[0]);
      const createdSet = mapGigSet(setRes.rows[0]);

      return res.status(201).json({
        gig: createdGig,
        initialSet: { ...createdSet, songs: [] }
      });
    }

    // --- PATCH GIG ---
    if (method === 'PATCH') {
      const { id, name, location, gigDate, startTime, arriveTime, notes, status } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'Bad Request', detail: 'Gig ID is required for update' });
      }

      // Verify ownership
      const ownership = await client.query('SELECT 1 FROM gigs WHERE id = $1 AND band_id = $2', [id, band.id]);
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden', detail: 'You do not own this gig' });
      }

      // Update fields dynamically or fully
      const gigRes = await client.query(
        `UPDATE gigs 
         SET name = COALESCE($1, name),
             location = COALESCE($2, location),
             gig_date = COALESCE($3, gig_date),
             start_time = COALESCE($4, start_time),
             arrival_time = COALESCE($5, arrival_time),
             notes = COALESCE($6, notes),
             status = COALESCE($7, status),
             updated_at = NOW()
         WHERE id = $8 AND band_id = $9
         RETURNING *`,
        [
          name !== undefined ? name.trim() : null,
          location !== undefined ? location : null,
          gigDate !== undefined ? gigDate || null : null,
          startTime !== undefined ? startTime : null,
          arriveTime !== undefined ? arriveTime : null,
          notes !== undefined ? notes : null,
          status !== undefined ? status : null,
          id,
          band.id
        ]
      );

      const updatedGig = mapGig(gigRes.rows[0]);
      return res.status(200).json(updatedGig);
    }

    // --- DELETE GIG ---
    if (method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) {
        return res.status(400).json({ error: 'Bad Request', detail: 'Gig ID is required for deletion' });
      }

      // Verify ownership
      const ownership = await client.query('SELECT 1 FROM gigs WHERE id = $1 AND band_id = $2', [id, band.id]);
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden', detail: 'You do not own this gig' });
      }

      await client.query('BEGIN');

      // Delete placements cascading
      await client.query(
        `DELETE FROM set_songs 
         WHERE set_id IN (SELECT id FROM gig_sets WHERE gig_id = $1)`,
        [id]
      );

      // Delete gig sets cascading
      await client.query(`DELETE FROM gig_sets WHERE gig_id = $1`, [id]);

      // Delete gig
      await client.query(`DELETE FROM gigs WHERE id = $1 AND band_id = $2`, [id, band.id]);

      await client.query('COMMIT');

      return res.status(200).json({ ok: true, message: `Gig ${id} and its sets deleted successfully` });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
    return res.status(405).json({ error: 'Method Not Allowed', detail: `Method ${method} not allowed on this endpoint` });

  } catch (error: any) {
    if (method === 'POST' || method === 'DELETE') {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
    }

    console.error('Gigs API failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      detail: error.message || 'Failed to complete gigs operation'
    });
  } finally {
    client.release();
  }
}
