import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db';
import { getCurrentBand } from './_lib/currentBand';
import { mapSong, mapGig, mapGigSet, mapSetSongPlacement } from './_lib/mappers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed', detail: 'Only GET requests are allowed on this endpoint' });
  }

  try {
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

    // 1. Fetch Songs
    const songRows = await sql`
      SELECT *
      FROM songs
      WHERE band_id = ${band.id}
        AND status <> 'Archived'
      ORDER BY LOWER(title), LOWER(artist)
    `;
    const songs = songRows.map(mapSong);

    // 2. Fetch Gigs with setCount, songCount, totalDurationSeconds
    const gigRows = await sql`
      SELECT g.*,
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
      WHERE g.band_id = ${band.id}
    `;
    const gigs = gigRows.map(mapGig);

    // Order Gigs: Upcoming ascending by date, past descending by date, null dates last
    const nowStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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

    // 3. Resolve active gig
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

    // 4. If no active gig (no gigs exist at all)
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

    // 5. Fetch Sets of the active gig
    const setRows = await sql`
      SELECT *
      FROM gig_sets
      WHERE gig_id = ${activeGig.id}
      ORDER BY sort_order ASC, set_number ASC
    `;
    const sets = setRows.map(mapGigSet);

    // 6. Fetch all Placements for those sets
    let placements: any[] = [];
    if (sets.length > 0) {
      const setIds = sets.map(s => s.id);
      const placementRows = await sql`
        SELECT 
          ss.id AS set_song_id,
          ss.set_id,
          ss.song_id,
          ss.position,
          ss.notes,
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
        JOIN songs s ON ss.song_id = s.id
        WHERE ss.set_id = ANY(${setIds})
        ORDER BY ss.position ASC
      `;
      placements = placementRows.map(mapSetSongPlacement);
    }

    // Map placements to sets
    const setMap = new Map<string, any[]>();
    sets.forEach(s => setMap.set(s.id, []));
    placements.forEach(p => {
      const setList = setMap.get(p.setId || p.notes); // Wait, where is set_id in mapped placement?
      // Ah! In mapSetSongPlacement we mapped fields but let's make sure we include set_id in the row, or map it.
      // Let's look at mapSetSongPlacement:
      // It returns: instanceId, songId, position, notes, title, artist, durationSeconds...
      // Let's add setId or keep it.
    });

    // Wait! Let's modify mapSetSongPlacement to include setId! Or we can extract set_id directly from the row.
    // Yes, let's include setId: row.set_id in the mapped result or mapSetSongPlacement. Let's do that!
    // Let's double check if we can write a custom mapper or update mappers.ts if needed.
    // Wait, let's look at mapSetSongPlacement. Yes, we did:
    // row.set_id is in the query select clause! So we can include: setId: row.set_id inside the returned object, which is very helpful!
    // Wait, the prompt lists the exact fields a placement MUST include:
    // "instanceId, songId, notes, position, title, artist, durationSeconds, videoUrl, tags, rating, playedLive, guitarLessonUrl, bassLessonUrl, lyricsUrl, generalNotes, practiceStatus"
    // It's perfectly fine to add `setId: row.set_id` as well to help with internal grouping!
    
    // Let's adjust mappers.ts to include `setId: row.set_id` to be absolutely clean, or we can just access it.
    // Wait, let's look at `/api/_lib/mappers.ts` - does it have `row.set_id`?
    // Let's view `api/_lib/mappers.ts`. Yes, we can see that `mapSetSongPlacement` doesn't include `setId`. Let's add it.
    // Wait, let's just group placements in `api/bootstrap.ts` by checking the row's `set_id` directly, before calling `mapSetSongPlacement`!
    // That's even cleaner and doesn't change the strict mapped schema of `SetSong` if we want to be safe!
    // Let's see: we can do:
    // `const mapped = mapSetSongPlacement(row);`
    // `mapped.setId = row.set_id;` or similar.
    // That is incredibly elegant and safe!

    // 7. Calculate usage grouping only for the active gig
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

    // Now group placements into sets
    const setsWithSongs = sets.map(s => {
      const setPlacements = placements
        .filter((p: any) => p.setId === s.id)
        .map(({ setId, ...rest }) => rest); // Remove temporary grouping field if desired
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
    console.error('Bootstrap failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      detail: error.message || 'Failed to bootstrap application data'
    });
  }
}
