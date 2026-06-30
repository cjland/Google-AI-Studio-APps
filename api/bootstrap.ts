import type {
  VercelRequest,
  VercelResponse
} from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { getSql, hasDatabaseUrl } from './_lib/db';
import {
  mapBand,
  mapSong,
  mapGig,
  mapGigSet,
  mapSetSongPlacement
} from './_lib/mappers';

const API_VERSION = 'bootstrap-v10-schema-safe';

function valueAsText(value: unknown): string | null {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function findNestedValue(
  error: any,
  key: string
): unknown {
  const sources = [
    error,
    error?.cause,
    error?.sourceError,
    error?.originalError,
    error?.error,
    error?.data,
    error?.response,
    error?.response?.data
  ];

  for (const source of sources) {
    if (
      source &&
      typeof source === 'object' &&
      source[key] !== undefined &&
      source[key] !== null
    ) {
      return source[key];
    }
  }

  return null;
}

function serializeError(error: unknown) {
  const err = error as any;

  const messageValue =
    findNestedValue(err, 'message') ??
    findNestedValue(err, 'error') ??
    findNestedValue(err, 'detail') ??
    error;

  return {
    name: valueAsText(
      findNestedValue(err, 'name')
    ),
    message:
      valueAsText(messageValue) ??
      'Unknown database error',
    code: valueAsText(
      findNestedValue(err, 'code')
    ),
    detail: valueAsText(
      findNestedValue(err, 'detail')
    ),
    hint: valueAsText(
      findNestedValue(err, 'hint')
    ),
    severity: valueAsText(
      findNestedValue(err, 'severity')
    ),
    table: valueAsText(
      findNestedValue(err, 'table')
    ),
    column: valueAsText(
      findNestedValue(err, 'column')
    ),
    constraint: valueAsText(
      findNestedValue(err, 'constraint')
    ),
    schema: valueAsText(
      findNestedValue(err, 'schema')
    ),
    cause: valueAsText(err?.cause),
    raw: valueAsText(error)
  };
}

function normalizeDate(value: unknown): string {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  const text = String(value);

  if (text.includes('T')) {
    return text.split('T')[0];
  }

  return text;
}

function normalizeId(value: unknown): string {
  return value === null || value === undefined
    ? ''
    : String(value);
}

function sortGigs(gigs: any[]): any[] {
  const today = new Date()
    .toISOString()
    .split('T')[0];

  return [...gigs].sort((a, b) => {
    const dateA = normalizeDate(a.gigDate);
    const dateB = normalizeDate(b.gigDate);

    if (!dateA && !dateB) {
      return 0;
    }

    if (!dateA) {
      return 1;
    }

    if (!dateB) {
      return -1;
    }

    const upcomingA = dateA >= today;
    const upcomingB = dateB >= today;

    if (upcomingA && upcomingB) {
      return dateA.localeCompare(dateB);
    }

    if (!upcomingA && !upcomingB) {
      return dateB.localeCompare(dateA);
    }

    return upcomingA ? -1 : 1;
  });
}

function chooseActiveGig(
  gigs: any[],
  requestedGigId?: string
) {
  if (requestedGigId) {
    const requested = gigs.find(
      gig =>
        normalizeId(gig.id) ===
        normalizeId(requestedGigId)
    );

    if (requested) {
      return requested;
    }
  }

  const today = new Date()
    .toISOString()
    .split('T')[0];

  const upcoming = gigs.find(gig => {
    const date = normalizeDate(gig.gigDate);
    return date && date >= today;
  });

  if (upcoming) {
    return upcoming;
  }

  if (gigs.length > 0) {
    return gigs[0];
  }

  return null;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const requestId = randomUUID();
  let stage = 'handler-start';

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader(
    'X-Setlist-API-Version',
    API_VERSION
  );
  res.setHeader(
    'X-Setlist-Request-ID',
    requestId
  );

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      apiVersion: API_VERSION,
      error: 'Method Not Allowed',
      message: 'Only GET requests are supported.',
      requestId,
      stage
    });
  }

  if (
    req.query.debug === 'ping' ||
    req.query.ping === '1'
  ) {
    return res.status(200).json({
      ok: true,
      apiVersion: API_VERSION,
      requestId,
      stage,
      databaseUrlPresent: hasDatabaseUrl(),
      vercelEnvironment:
        process.env.VERCEL_ENV ?? null,
      deploymentId:
        process.env.VERCEL_DEPLOYMENT_ID ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        null
    });
  }

  try {
    stage = 'create-neon-client';
    const sql = getSql();

    stage = 'connection-test';
    await sql`
      SELECT 1 AS connected
    `;

    stage = 'resolve-band';

    const bandRows = await sql`
      SELECT *
      FROM bands
      ORDER BY created_at ASC NULLS LAST
      LIMIT 1
    `;

    const band = bandRows.length > 0
      ? mapBand(bandRows[0])
      : null;

    if (!band) {
      return res.status(200).json({
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        setupRequired: true,
        band: null,
        songs: [],
        gigs: [],
        activeGig: null,
        sets: [],
        usage: {}
      });
    }

    stage = 'load-songs';

    const songRows = await sql`
      SELECT *
      FROM songs
      WHERE band_id = ${band.id}
      ORDER BY
        LOWER(COALESCE(title, '')),
        LOWER(COALESCE(artist, ''))
    `;

    const songs = songRows
      .map(mapSong)
      .filter(Boolean)
      .filter(
        song =>
          song.active !== false
      );

    stage = 'load-gigs';

    const gigRows = await sql`
      SELECT *
      FROM gigs
      WHERE band_id = ${band.id}
    `;

    const mappedGigs = gigRows
      .map(mapGig)
      .filter(Boolean)
      .map(gig => ({
        ...gig,
        gigDate: normalizeDate(gig.gigDate)
      }));

    const sortedGigs = sortGigs(mappedGigs);

    stage = 'resolve-active-gig';

    const requestedGigId =
      typeof req.query.gigId === 'string'
        ? req.query.gigId
        : undefined;

    const activeGig = chooseActiveGig(
      sortedGigs,
      requestedGigId
    );

    if (!activeGig) {
      return res.status(200).json({
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        setupRequired: false,
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
      SELECT *
      FROM gig_sets
      WHERE gig_id = ${activeGig.id}
      ORDER BY
        sort_order ASC NULLS LAST,
        set_number ASC NULLS LAST,
        created_at ASC NULLS LAST
    `;

    const sets = setRows
      .map(mapGigSet)
      .filter(Boolean);

    stage = 'load-placements';

    const placementRows: any[] = [];

    for (const set of sets) {
      const rows = await sql`
        SELECT
          ss.id AS set_song_id,
          ss.set_id,
          ss.song_id,
          ss.position,
          to_jsonb(ss) AS placement,
          to_jsonb(s) AS song
        FROM set_songs ss
        INNER JOIN songs s
          ON s.id = ss.song_id
        WHERE ss.set_id = ${set.id}
        ORDER BY
          ss.position ASC NULLS LAST,
          ss.id ASC
      `;

      placementRows.push(...rows);
    }

    const placements = placementRows
      .map(mapSetSongPlacement)
      .filter(Boolean);

    stage = 'build-sets';

    const setsWithSongs = sets.map(set => ({
      ...set,
      songs: placements
        .filter(
          placement =>
            normalizeId(placement.setId) ===
            normalizeId(set.id)
        )
        .sort(
          (a, b) =>
            Number(a.position ?? 0) -
            Number(b.position ?? 0)
        )
    }));

    stage = 'build-usage';

    const usage: Record<string, any[]> = {};

    for (const set of setsWithSongs) {
      for (const placement of set.songs) {
        const songId = normalizeId(
          placement.songId
        );

        if (!songId) {
          continue;
        }

        if (!usage[songId]) {
          usage[songId] = [];
        }

        usage[songId].push({
          setId: set.id,
          setNumber: set.setNumber,
          setName: set.name,
          count: 1
        });
      }
    }

    stage = 'calculate-gig-totals';

    const activeSetCount = setsWithSongs.length;

    const activeSongCount = setsWithSongs.reduce(
      (total, set) =>
        total + set.songs.length,
      0
    );

    const activeDuration = setsWithSongs.reduce(
      (total, set) =>
        total +
        set.songs.reduce(
          (setTotal: number, song: any) =>
            setTotal +
            Number(song.durationSeconds || 0),
          0
        ),
      0
    );

    const gigsWithTotals = sortedGigs.map(gig => {
      if (
        normalizeId(gig.id) !==
        normalizeId(activeGig.id)
      ) {
        return gig;
      }

      return {
        ...gig,
        setCount: activeSetCount,
        songCount: activeSongCount,
        totalDurationSeconds: activeDuration
      };
    });

    const activeGigWithTotals = {
      ...activeGig,
      setCount: activeSetCount,
      songCount: activeSongCount,
      totalDurationSeconds: activeDuration
    };

    stage = 'build-response';

    return res.status(200).json({
      ok: true,
      apiVersion: API_VERSION,
      requestId,
      setupRequired: false,
      band,
      songs,
      gigs: gigsWithTotals,
      activeGig: activeGigWithTotals,
      sets: setsWithSongs,
      usage
    });
  } catch (error: unknown) {
    const databaseError = serializeError(error);

    console.error('Bootstrap failed', {
      apiVersion: API_VERSION,
      requestId,
      stage,
      databaseError
    });

    return res.status(500).json({
      ok: false,
      apiVersion: API_VERSION,
      error: 'Unable to load setlist data.',
      message: databaseError.message,
      detail:
        databaseError.detail ??
        databaseError.raw ??
        'The database query failed.',
      requestId,
      stage,
      code: databaseError.code,
      hint: databaseError.hint,
      severity: databaseError.severity,
      databaseTable: databaseError.table,
      databaseColumn: databaseError.column,
      databaseConstraint:
        databaseError.constraint,
      databaseError
    });
  }
}