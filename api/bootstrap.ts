import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { getSql } from './_lib/db';
import { getCurrentBand } from './_lib/currentBand';
import { mapSong, mapGig, mapGigSet, mapSetSongPlacement } from './_lib/mappers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = randomUUID();
  let stage = 'start';

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({
      ok: false,
      error: 'Method Not Allowed',
      requestId,
      stage
    });
  }

  try {
    const sql = getSql();

    stage = 'resolve-band';
    const band = await getCurrentBand();

    if (!band) {
      return res.status(200).json({
        setupRequired: true,
        band: null,
        songs: [],
        gigs: [],
        activeGig: null,
        sets: [],
        usage: {}
      });
    }

    const gigId = req.query.gigId as string | undefined;

    stage = 'load-songs';
    const songRows = await sql`
      SELECT
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
        created_at,
        updated_at
      FROM songs
      WHERE band_id = ${band.id}
        AND LOWER(status) <> 'archived'
      ORDER BY
        LOWER(title),
        LOWER(COALESCE(artist, ''));
    `;
    const songs = songRows.map(mapSong);

    stage = 'load-gigs';
    const gigRows = await sql`
      SELECT
        g.id,
        g.band_id,
        g.name,
        g.location,
        g.gig_date,
        g.arrival_time,
        g.start_time,
        g.notes,
        g.status,
        g.created_at,
        g.updated_at,
        (
          SELECT COUNT(*)::INTEGER
          FROM gig_sets gs
          WHERE gs.gig_id = g.id
        ) AS set_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM set_songs ss
          JOIN gig_sets gs
            ON gs.id = ss.set_id
          WHERE gs.gig_id = g.id
        ) AS song_count,
        COALESCE(
          (
            SELECT SUM(COALESCE(s.duration_seconds, 0))::INTEGER
            FROM set_songs ss
            JOIN gig_sets gs
              ON gs.id = ss.set_id
            JOIN songs s
              ON s.id = ss.song_id
            WHERE gs.gig_id = g.id
          ),
          0
        ) AS total_duration_seconds
      FROM gigs g
      WHERE g.band_id = ${band.id};
    `;
    const gigs = gigRows.map(mapGig);

    // Order Gigs: Upcoming ascending by date, past descending by date, null dates last
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

    stage = 'resolve-active-gig';
    let activeGig = null;
    if (gigId) {
      activeGig = sortedGigs.find(g => g.id === gigId) || null;
    }

    if (!activeGig) {
      const upcoming = sortedGigs.find(g => g.gigDate && g.gigDate >= nowStr);
      if (upcoming) {
        activeGig = upcoming;
      } else {
        const sortedByUpdate = [...gigs].sort((a, b) => {
          const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return timeB - timeA;
        });
        if (sortedByUpdate.length > 0) {
          activeGig = sortedByUpdate[0];
        }
      }
    }

    if (!activeGig) {
      return res.status(200).json({
        band,
        songs,
        gigs: sortedGigs,
        activeGig: null,
        sets: [],
        usage: {}
      });
    }

    stage = 'load-sets';
    const setRows = await sql`
      SELECT
        id,
        gig_id,
        name,
        set_number,
        status,
        target_duration_seconds,
        sort_order,
        created_at,
        updated_at
      FROM gig_sets
      WHERE gig_id = ${activeGig.id}
      ORDER BY sort_order, set_number;
    `;
    const sets = setRows.map(mapGigSet);

    stage = 'load-placements';
    const placementRows: any[] = [];
    for (const set of sets) {
      const rows = await sql`
        SELECT
          ss.id AS set_song_id,
          ss.set_id,
          ss.song_id,
          ss.position,
          ss.notes AS placement_notes,
          s.title,
          s.artist,
          s.duration_seconds,
          s.video_url,
          s.tags,
          s.rating,
          s.guitar_url,
          s.bass_url,
          s.lyrics_url,
          s.notes AS song_notes,
          s.status
        FROM set_songs ss
        JOIN songs s
          ON s.id = ss.song_id
        WHERE ss.set_id = ${set.id}
        ORDER BY ss.position ASC
      `;
      placementRows.push(...rows);
    }
    const placements = placementRows.map(mapSetSongPlacement);

    stage = 'load-usage';
    const usageRows = await sql`
      SELECT 
        ss.song_id,
        ss.set_id,
        gs.set_number,
        gs.name AS set_name,
        COUNT(*)::int AS count
      FROM set_songs ss
      JOIN gig_sets gs ON ss.set_id = gs.id
      WHERE gs.gig_id = ${activeGig.id}
      GROUP BY ss.song_id, ss.set_id, gs.set_number, gs.name
      ORDER BY gs.set_number ASC
    `;

    const usage: Record<string, any[]> = {};
    for (const row of usageRows) {
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

    stage = 'build-response';
    const setsWithSongs = sets.map(s => {
      const setPlacements = placements
        .filter((p: any) => p.setId === s.id);
      return {
        ...s,
        songs: setPlacements
      };
    });

    return res.status(200).json({
      band,
      songs,
      gigs: sortedGigs,
      activeGig,
      sets: setsWithSongs,
      usage
    });

  } catch (error: any) {
    console.error('Bootstrap failed', {
      requestId,
      stage,
      code: error?.code ?? null,
      message: error?.message ?? null,
      detail: error?.detail ?? null,
      table: error?.table ?? null,
      column: error?.column ?? null,
      constraint: error?.constraint ?? null
    });
    return res.status(500).json({
      ok: false,
      error: 'Unable to load setlist data.',
      requestId,
      stage,
      code: error?.code ?? null,
      message: error?.message ?? null,
      detail: error?.detail ?? null,
      databaseTable: error?.table ?? null,
      databaseColumn: error?.column ?? null,
      databaseConstraint: error?.constraint ?? null
    });
  }
}
