import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';


import { getCurrentBand } from './_lib/currentBand.js';
import {
  mapSong,
  mapGig,
  mapGigSet,
  mapSetSongPlacement
} from './_lib/mappers.js';
import { getSql } from './_lib/db.js';



let pool: Pool | null = null;

function isValidUUID(val: string): boolean {
  if (!val) return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(val);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Method Not Allowed', detail: 'Only PUT requests are allowed on this endpoint' });
  }

  const { bandSettings, songs, gig, sets } = req.body || {};

  // --- VALIDATION ---
  if (!bandSettings || !songs || !gig || !sets) {
    return res.status(400).json({ error: 'Bad Request', detail: 'Missing required state fields in request body' });
  }

  // Validate titles and names are non-empty
  if (!bandSettings.name || !bandSettings.name.trim()) {
    return res.status(400).json({ error: 'Bad Request', detail: 'Band name cannot be empty' });
  }
  if (!gig.name || !gig.name.trim()) {
    return res.status(400).json({ error: 'Bad Request', detail: 'Gig name cannot be empty' });
  }

  // Validate ratings and durations
  for (const song of songs) {
    if (!song.title || !song.title.trim()) {
      return res.status(400).json({ error: 'Bad Request', detail: 'Song title cannot be empty' });
    }
    if (song.durationSeconds < 0) {
      return res.status(400).json({ error: 'Bad Request', detail: `Duration for song "${song.title}" must be non-negative` });
    }
    if (song.rating !== undefined && song.rating !== null) {
      const ratingNum = Number(song.rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'Bad Request', detail: `Rating for song "${song.title}" must be between 1 and 5` });
      }
    }
  }

  const sql = getSql();
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  const client = await pool.connect();

  try {
    // 1. Resolve current band first to verify ownership
    const band = await getCurrentBand();
    if (!band) {
      return res.status(400).json({ error: 'Setup Required', detail: 'No active band found. Please configure a band first.' });
    }

    // --- ID NORMALIZATION MAPS ---
    const songIdMap: Record<string, string> = {};
    const setIdMap: Record<string, string> = {};

    // Begin Transaction
    await client.query('BEGIN');

    // 2. Update Band
    await client.query(
      `UPDATE bands 
       SET name = $1, updated_at = NOW() 
       WHERE id = $2
       RETURNING id, name, created_at, updated_at`,
      [
        bandSettings.name,
        band.id
      ]
    );

    // 3. Upsert Songs
    const dbSongs: any[] = [];
    for (const song of songs) {
      let finalSongId = song.id;
      if (!isValidUUID(song.id)) {
        finalSongId = uuidv4();
      }
      songIdMap[song.id] = finalSongId;

      const duration = Number(song.durationSeconds) || 0;
      const rating = song.rating ? Number(song.rating) : null;
      const tags = Array.isArray(song.tags) ? song.tags : [];

      const sRes = await client.query(
        `INSERT INTO songs (
          id, band_id, external_id, title, artist, duration_seconds, video_url, tags, rating, status, guitar_url, bass_url, lyrics_url, notes, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          external_id = EXCLUDED.external_id,
          title = EXCLUDED.title,
          artist = EXCLUDED.artist,
          duration_seconds = EXCLUDED.duration_seconds,
          video_url = EXCLUDED.video_url,
          tags = EXCLUDED.tags,
          rating = EXCLUDED.rating,
          status = EXCLUDED.status,
          guitar_url = EXCLUDED.guitar_url,
          bass_url = EXCLUDED.bass_url,
          lyrics_url = EXCLUDED.lyrics_url,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *`,
        [
          finalSongId,
          band.id,
          song.externalId || null,
          song.title,
          song.artist || 'Unknown Artist',
          duration,
          song.videoUrl || null,
          tags,
          rating,
          song.practiceStatus || 'Draft',
          song.guitarLessonUrl || null,
          song.bassLessonUrl || null,
          song.lyricsUrl || null,
          song.generalNotes || null
        ]
      );
      dbSongs.push(mapSong(sRes.rows[0]));
    }

    // 4. Upsert Gig
    let finalGigId = gig.id;
    if (!isValidUUID(gig.id)) {
      finalGigId = uuidv4();
    }

    const gRes = await client.query(
      `INSERT INTO gigs (
        id, band_id, name, location, gig_date, start_time, arrival_time, notes, status, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        gig_date = EXCLUDED.gig_date,
        start_time = EXCLUDED.start_time,
        arrival_time = EXCLUDED.arrival_time,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *`,
      [
        finalGigId,
        band.id,
        gig.name,
        gig.location || '',
        gig.gigDate || null,
        gig.startTime || '',
        gig.arriveTime || '',
        gig.notes || '',
        gig.status || 'Draft'
      ]
    );
    const dbGig = mapGig(gRes.rows[0]);

    // 5. Upsert sets
    const dbSets: any[] = [];
    const activeSetIds: string[] = [];
    const activePlacementIds: string[] = [];

    for (let i = 0; i < sets.length; i++) {
      const setItem = sets[i];
      let finalSetId = setItem.id;
      if (!isValidUUID(setItem.id)) {
        finalSetId = uuidv4();
      }
      setIdMap[setItem.id] = finalSetId;
      activeSetIds.push(finalSetId);

      const setNumber = setItem.setNumber || (i + 1);
      const sortOrder = setItem.sortOrder !== undefined ? setItem.sortOrder : (i + 1);
      const targetDuration = setItem.targetDurationSeconds ? Number(setItem.targetDurationSeconds) : null;

      const setRes = await client.query(
        `INSERT INTO gig_sets (
          id, gig_id, name, set_number, sort_order, status, target_duration_seconds, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          set_number = EXCLUDED.set_number,
          sort_order = EXCLUDED.sort_order,
          status = EXCLUDED.status,
          target_duration_seconds = EXCLUDED.target_duration_seconds,
          updated_at = NOW()
        RETURNING *`,
        [
          finalSetId,
          finalGigId,
          setItem.name,
          setNumber,
          sortOrder,
          setItem.status || 'Draft',
          targetDuration
        ]
      );
      const mappedSet = mapGigSet(setRes.rows[0]);

      // Placements in this set
      const placementSongs = setItem.songs || [];
      const mappedSongsList: any[] = [];

      for (let pIdx = 0; pIdx < placementSongs.length; pIdx++) {
        const pSong = placementSongs[pIdx];
        let finalPlacementId = pSong.instanceId;
        if (!isValidUUID(pSong.instanceId)) {
          finalPlacementId = uuidv4();
        }
        activePlacementIds.push(finalPlacementId);

        // Resolve the real song UUID
        const realSongId = songIdMap[pSong.songId] || pSong.songId;

        const pRes = await client.query(
          `INSERT INTO set_songs (
            id, set_id, song_id, position, notes, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            set_id = EXCLUDED.set_id,
            song_id = EXCLUDED.song_id,
            position = EXCLUDED.position,
            notes = EXCLUDED.notes,
            updated_at = NOW()
          RETURNING *`,
          [
            finalPlacementId,
            finalSetId,
            realSongId,
            pIdx,
            pSong.notes || null
          ]
        );

        // Map the stored placement and pair it with song details
        const storedPlacement = pRes.rows[0];
        // Find corresponding song in dbSongs list
        const songDetail = dbSongs.find(s => s.id === realSongId);

        mappedSongsList.push({
          instanceId: storedPlacement.id,
          songId: storedPlacement.song_id,
          notes: storedPlacement.notes,
          position: Number(storedPlacement.position),
          title: songDetail?.title || '',
          artist: songDetail?.artist || '',
          durationSeconds: Number(songDetail?.durationSeconds || 0),
          videoUrl: songDetail?.videoUrl || null,
          tags: songDetail?.tags || [],
          rating: songDetail?.rating || null,
          playedLive: !!songDetail?.playedLive,
          guitarLessonUrl: songDetail?.guitarLessonUrl || null,
          bassLessonUrl: songDetail?.bassLessonUrl || null,
          lyricsUrl: songDetail?.lyricsUrl || null,
          generalNotes: songDetail?.generalNotes || null,
          practiceStatus: songDetail?.practiceStatus || null
        });
      }

      mappedSet.songs = mappedSongsList;
      dbSets.push(mappedSet);
    }

    // 6. Delete placements removed from submitted sets
    if (activeSetIds.length > 0) {
      if (activePlacementIds.length > 0) {
        await client.query(
          `DELETE FROM set_songs 
           WHERE set_id = ANY($1) 
             AND id <> ALL($2)`,
          [activeSetIds, activePlacementIds]
        );
      } else {
        await client.query(
          `DELETE FROM set_songs 
           WHERE set_id = ANY($1)`,
          [activeSetIds]
        );
      }
    }

    // 7. Delete sets removed from the submitted gig
    if (activeSetIds.length > 0) {
      await client.query(
        `DELETE FROM gig_sets 
         WHERE gig_id = $1 
           AND id <> ALL($2)`,
        [finalGigId, activeSetIds]
      );
    } else {
      await client.query(
        `DELETE FROM gig_sets 
         WHERE gig_id = $1`,
        [finalGigId]
      );
    }

    // Commit Transaction
    await client.query('COMMIT');

    // 8. Fetch updated Usage Map
    const usageRows = await client.query(
      `SELECT 
        ss.song_id,
        ss.set_id,
        gs.set_number,
        gs.name AS set_name,
        COUNT(*)::int AS count
      FROM set_songs ss
      JOIN gig_sets gs ON ss.set_id = gs.id
      WHERE gs.gig_id = $1
      GROUP BY ss.song_id, ss.set_id, gs.set_number, gs.name
      ORDER BY gs.set_number ASC`,
      [finalGigId]
    );

    const usage: Record<string, any[]> = {};
    for (const row of usageRows.rows) {
      const songId = row.song_id;
      if (!usage[songId]) {
        usage[songId] = [];
      }
      usage[songId].push({
        setId: row.set_id,
        setNumber: row.set_number,
        setName: row.set_name,
        count: row.count
      });
    }

    // Resolve final updated band info
    const updatedBand = await getCurrentBand();

    return res.status(200).json({
      ok: true,
      band: updatedBand,
      songs: dbSongs,
      gig: dbGig,
      sets: dbSets,
      usage,
      savedAt: new Date().toISOString()
    });

  } catch (error: any) {
    // Rollback Transaction
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('Rollback failed:', rbErr);
    }

    console.error('Save state failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      detail: error.message || 'Failed to save application state'
    });
  } finally {
    client.release();
  }
}
