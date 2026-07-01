import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';


import { getCurrentBand } from './_lib/currentBand.js';
import {
  mapBand,
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

function normalizeSongStatus(song: any): string {
  const normalized = String(
    song?.status ??
    song?.practiceStatus ??
    'ready'
  )
    .trim()
    .toLowerCase();

  if (normalized === 'practice') {
    return 'practice';
  }

  if (normalized === 'live') {
    return 'live';
  }

  if (
    normalized === 'inactive' ||
    normalized === 'archived'
  ) {
    return 'inactive';
  }

  return 'ready';
}

function normalizeGigStatus(
  value: unknown
): string {
  const normalized =
    String(value ?? 'draft')
      .trim()
      .toLowerCase();

  if (normalized === 'upcoming') {
    return 'upcoming';
  }

  if (
    normalized === 'completed' ||
    normalized === 'complete'
  ) {
    return 'completed';
  }

  if (
    normalized === 'cancelled' ||
    normalized === 'canceled'
  ) {
    return 'cancelled';
  }

  return 'draft';
}

function normalizeGigSetStatus(
  value: unknown
): string {
  const normalized =
    String(value ?? 'draft')
      .trim()
      .toLowerCase();

  if (normalized === 'active') {
    return 'active';
  }

  if (
    normalized === 'completed' ||
    normalized === 'complete'
  ) {
    return 'completed';
  }

  if (
    normalized === 'locked'
  ) {
    return 'locked';
  }

  return 'draft';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({
      ok: false,
      stage: 'validate-payload',
      message: 'Method Not Allowed',
      code: 'METHOD_NOT_ALLOWED',
      detail: 'Only PUT requests are allowed on this endpoint'
    });
  }

  let currentStage = 'validate-payload';
  let stage = 'validate-payload';

  const { bandSettings, songs, gig, sets } = req.body || {};

  // --- VALIDATION ---
  if (!bandSettings || !songs || !gig || !sets) {
    return res.status(400).json({
      ok: false,
      stage: 'validate-payload',
      message: 'Bad Request',
      code: 'MISSING_PAYLOAD',
      detail: 'Missing required state fields in request body'
    });
  }

  // Validate titles and names are non-empty
  if (!bandSettings.name || !bandSettings.name.trim()) {
    return res.status(400).json({
      ok: false,
      stage: 'validate-payload',
      message: 'Bad Request',
      code: 'EMPTY_BAND_NAME',
      detail: 'Band name cannot be empty'
    });
  }
  if (!gig.name || !gig.name.trim()) {
    return res.status(400).json({
      ok: false,
      stage: 'validate-payload',
      message: 'Bad Request',
      code: 'EMPTY_GIG_NAME',
      detail: 'Gig name cannot be empty'
    });
  }

  // Validate ratings and durations
  for (const song of songs) {
    if (!song.title || !song.title.trim()) {
      return res.status(400).json({
        ok: false,
        stage: 'validate-payload',
        message: 'Bad Request',
        code: 'EMPTY_SONG_TITLE',
        detail: 'Song title cannot be empty'
      });
    }
    if (song.durationSeconds < 0) {
      return res.status(400).json({
        ok: false,
        stage: 'validate-payload',
        message: 'Bad Request',
        code: 'INVALID_SONG_DURATION',
        detail: `Duration for song "${song.title}" must be non-negative`
      });
    }
    if (song.rating !== undefined && song.rating !== null) {
      const ratingNum = Number(song.rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({
          ok: false,
          stage: 'validate-payload',
          message: 'Bad Request',
          code: 'INVALID_SONG_RATING',
          detail: `Rating for song "${song.title}" must be between 1 and 5`
        });
      }
    }
  }

  const sql = getSql();
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  let client: any = null;

  try {
    // 1. Resolve current band first to verify ownership
    currentStage = 'load-band';
    const band = await getCurrentBand();
    if (!band) {
      return res.status(400).json({
        ok: false,
        stage: 'load-band',
        message: 'No active band found. Please configure a band first.',
        code: 'NO_ACTIVE_BAND',
        detail: 'Setup Required'
      });
    }

    // --- ID PREP & NORMALIZATION MAPS ---
    const songIdMap: Record<string, string> = {};
    const setIdMap: Record<string, string> = {};
    const activeSetIds: string[] = [];
    const activePlacementIds: string[] = [];
    const placementIdMap: Record<string, string> = {}; // original placement instanceId -> final placement instanceId

    for (const song of songs) {
      let finalSongId = song.id;
      if (!isValidUUID(song.id)) {
        finalSongId = uuidv4();
      }
      songIdMap[song.id] = finalSongId;
    }

    for (let i = 0; i < sets.length; i++) {
      const setItem = sets[i];
      let finalSetId = setItem.id;
      if (!isValidUUID(setItem.id)) {
        finalSetId = uuidv4();
      }
      setIdMap[setItem.id] = finalSetId;
      activeSetIds.push(finalSetId);

      const placementSongs = setItem.songs || [];
      for (const pSong of placementSongs) {
        let finalPlacementId = pSong.instanceId;
        if (!isValidUUID(pSong.instanceId)) {
          finalPlacementId = uuidv4();
        }
        placementIdMap[pSong.instanceId] = finalPlacementId;
        activePlacementIds.push(finalPlacementId);
      }
    }

    let finalGigId = gig.id;
    if (!isValidUUID(gig.id)) {
      finalGigId = uuidv4();
    }

    client = await pool.connect();

    // Begin Transaction
    await client.query('BEGIN');

    // 2. Update Band
    stage = 'save-band';
    currentStage = 'save-band';
    const bandResult = await client.query(
      `UPDATE public.bands
       SET
         name = $1,
         logo_url = $2,
         members = $3,
         updated_at = NOW()
       WHERE id = $4
       RETURNING
         id,
         name,
         logo_url,
         members,
         created_at,
         updated_at`,
      [
        bandSettings.name,
        bandSettings.logoUrl || null,
        Array.isArray(bandSettings.members)
          ? bandSettings.members
              .map((member: string) =>
                member.trim()
              )
              .filter(Boolean)
          : [],
        band.id
      ]
    );

    const savedBand = mapBand(bandResult.rows[0]);

    // 3. Upsert Songs
    currentStage = 'upsert-songs';
    const dbSongs: any[] = [];
    for (const song of songs) {
      const finalSongId = songIdMap[song.id];
      const databaseStatus = normalizeSongStatus(song);
      stage = `upsert-song:${song.title || song.id}`;
      currentStage = stage;

      const sRes = await client.query(
        `INSERT INTO public.songs (
          id,
          band_id,
          external_id,
          title,
          artist,
          duration_seconds,
          rating,
          status,
          video_url,
          guitar_url,
          bass_url,
          lyrics_url,
          notes,
          tags,
          google_sheet_row,
          source_updated_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          NOW()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          external_id = EXCLUDED.external_id,
          title = EXCLUDED.title,
          artist = EXCLUDED.artist,
          duration_seconds = EXCLUDED.duration_seconds,
          rating = EXCLUDED.rating,
          status = EXCLUDED.status,
          video_url = EXCLUDED.video_url,
          guitar_url = EXCLUDED.guitar_url,
          bass_url = EXCLUDED.bass_url,
          lyrics_url = EXCLUDED.lyrics_url,
          notes = EXCLUDED.notes,
          tags = EXCLUDED.tags,
          google_sheet_row = EXCLUDED.google_sheet_row,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = NOW()
        RETURNING *`,
        [
          finalSongId,
          band.id,
          song.externalId || null,
          song.title || 'Untitled Song',
          song.artist || 'Unknown Artist',
          Number(song.durationSeconds) || 0,
          song.rating === null || song.rating === undefined ? null : Number(song.rating),
          databaseStatus,
          song.videoUrl || null,
          song.guitarLessonUrl || null,
          song.bassLessonUrl || null,
          song.lyricsUrl || null,
          song.generalNotes || null,
          Array.isArray(song.tags) ? song.tags : [],
          song.googleSheetRow === null || song.googleSheetRow === undefined ? null : Number(song.googleSheetRow),
          song.sourceUpdatedAt || null
        ]
      );
      dbSongs.push(mapSong(sRes.rows[0]));
    }

    // 6. Delete placements/sets removed from submitted sets/gig
    stage = 'delete-removed-songs';
    currentStage = 'delete-removed-songs';
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

    // 4. Upsert Gig
    const databaseGigStatus = normalizeGigStatus(gig.status);
    stage = `save-gig:${gig.name || gig.id}`;
    currentStage = 'save-gig';
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
        databaseGigStatus
      ]
    );
    const dbGig = mapGig(gRes.rows[0]);

    // 5. Upsert sets
    currentStage = 'save-sets';
    const dbSets: any[] = [];
    for (let i = 0; i < sets.length; i++) {
      const setItem = sets[i];
      const finalSetId = setIdMap[setItem.id];

      const setNumber = setItem.setNumber || (i + 1);
      const sortOrder = setItem.sortOrder !== undefined ? setItem.sortOrder : (i + 1);
      const targetDuration = setItem.targetDurationSeconds ? Number(setItem.targetDurationSeconds) : null;

      const databaseSetStatus = normalizeGigSetStatus(setItem.status);
      stage = `save-set:${setItem.name || setItem.id}`;

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
          databaseSetStatus,
          targetDuration
        ]
      );
      const mappedSet = mapGigSet(setRes.rows[0]);
      dbSets.push({ ...mappedSet, setItemSongs: setItem.songs || [] });
    }

    // 5b. Upsert set song placements
    currentStage = 'save-placements';
    let totalPlacementsSaved = 0;
    const finalSetsResponse: any[] = [];

    for (const mappedSet of dbSets) {
      const finalSetId = mappedSet.id;
      const placementSongs = mappedSet.setItemSongs;
      const mappedSongsList: any[] = [];

      for (let pIdx = 0; pIdx < placementSongs.length; pIdx++) {
        const pSong = placementSongs[pIdx];
        const finalPlacementId = placementIdMap[pSong.instanceId];
        const realSongId = songIdMap[pSong.songId] || pSong.songId;

        stage = `save-placement:${pSong.songId}`;

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

        totalPlacementsSaved++;

        const storedPlacement = pRes.rows[0];
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

      delete mappedSet.setItemSongs;
      mappedSet.songs = mappedSongsList;
      finalSetsResponse.push(mappedSet);
    }

    // 8. Fetch updated Usage Map
    currentStage = 'build-response';

    // Commit Transaction
    await client.query('COMMIT');

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

    return res.status(200).json({
      ok: true,
      savedSongCount: dbSongs.length,
      savedSetCount: finalSetsResponse.length,
      savedPlacementCount: totalPlacementsSaved,
      band: savedBand,
      songs: dbSongs,
      gig: dbGig,
      sets: finalSetsResponse,
      usage,
      savedAt: new Date().toISOString()
    });

  } catch (error: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
    }

    console.error(`Save state failed at stage "${stage}":`, error);
    return res.status(500).json({
      ok: false,
      stage,
      message:
        error?.message ||
        'Unable to save state.',
      code: error?.code || null,
      detail: error?.detail || null,
      hint: error?.hint || null,
      constraint:
        error?.constraint || null,
      column:
        error?.column || null,
      table:
        error?.table || null,
      schema:
        error?.schema || null,
      severity:
        error?.severity || null
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}
