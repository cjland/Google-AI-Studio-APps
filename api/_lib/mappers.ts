function safeString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  return String(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => safeString(item).trim())
      .filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return parsed
          .map(item => safeString(item).trim())
          .filter(Boolean);
      }
    } catch {
      // Fall through to comma-separated parsing.
    }
  }

  return trimmed
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function displayStatus(value: unknown, fallback: string): string {
  const status = safeString(value, fallback).trim() || fallback;

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function mapBand(row: any) {
  if (!row) {
    return null;
  }

  return {
    id: safeString(row.id),
    name: safeString(row.name, 'Rock Em Sock Em'),
    members: Array.isArray(row.members) ? row.members : [],
    logoUrl: row.logo_url ?? row.logoUrl ?? null,
    defaultLibraryUrl:
      row.default_library_url ??
      row.defaultLibraryUrl ??
      null,
    bandProfileUrl:
      row.band_profile_url ??
      row.bandProfileUrl ??
      null,
    gigDetailsUrl:
      row.gig_details_url ??
      row.gigDetailsUrl ??
      null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

export function mapSong(row: any) {
  if (!row) {
    return null;
  }

  const status = safeString(row.status, 'practice').toLowerCase();

  return {
    id: safeString(row.id),
    externalId: row.external_id ?? row.externalId ?? null,
    title: safeString(row.title, 'Untitled Song'),
    artist: safeString(row.artist, 'Unknown Artist'),
    durationSeconds: safeNumber(
      row.duration_seconds ?? row.durationSeconds,
      0
    ),
    videoUrl: row.video_url ?? row.videoUrl ?? null,
    tags: safeTags(row.tags),
    rating: safeNullableNumber(row.rating),
    playedLive: Boolean(
      row.played_live ??
      row.playedLive ??
      false
    ),
    guitarLessonUrl:
      row.guitar_url ??
      row.guitar_lesson_url ??
      row.guitarLessonUrl ??
      null,
    bassLessonUrl:
      row.bass_url ??
      row.bass_lesson_url ??
      row.bassLessonUrl ??
      null,
    lyricsUrl:
      row.lyrics_url ??
      row.lyricsUrl ??
      null,
    generalNotes:
      row.notes ??
      row.general_notes ??
      row.generalNotes ??
      null,
    practiceStatus: displayStatus(status, 'practice'),
    active: status !== 'inactive' && status !== 'archived'
  };
}

export function mapGig(row: any) {
  if (!row) {
    return null;
  }

  const status = safeString(row.status, 'draft');

  return {
    id: safeString(row.id),
    name: safeString(row.name, 'Untitled Gig'),
    location: safeString(row.location),
    gigDate: safeString(
      row.gig_date ??
      row.date ??
      row.gigDate
    ),
    startTime: safeString(
      row.start_time ??
      row.startTime
    ),
    arriveTime: safeString(
      row.arrival_time ??
      row.arrive_time ??
      row.arriveTime
    ),
    notes: safeString(row.notes),
    status: displayStatus(status, 'draft'),
    bandId: safeString(
      row.band_id ??
      row.bandId
    ),
    setCount:
      row.set_count !== undefined
        ? safeNumber(row.set_count)
        : undefined,
    songCount:
      row.song_count !== undefined
        ? safeNumber(row.song_count)
        : undefined,
    totalDurationSeconds:
      row.total_duration_seconds !== undefined
        ? safeNumber(row.total_duration_seconds)
        : undefined,
    createdAt:
      row.created_at ??
      row.createdAt ??
      null,
    updatedAt:
      row.updated_at ??
      row.updatedAt ??
      null
  };
}

export function mapGigSet(row: any) {
  if (!row) {
    return null;
  }

  const status = safeString(row.status, 'draft');

  return {
    id: safeString(row.id),
    gigId: safeString(
      row.gig_id ??
      row.gigId
    ),
    name: safeString(
      row.name,
      `Set ${safeNumber(row.set_number, 1)}`
    ),
    setNumber: safeNumber(
      row.set_number ??
      row.setNumber,
      1
    ),
    sortOrder: safeNumber(
      row.sort_order ??
      row.sortOrder ??
      row.set_number,
      1
    ),
    color: safeString(row.color),
    status: displayStatus(status, 'draft'),
    targetDurationSeconds:
      row.target_duration_seconds !== null &&
      row.target_duration_seconds !== undefined
        ? safeNumber(row.target_duration_seconds)
        : undefined,
    songs: []
  };
}

export function mapSetSongPlacement(row: any) {
  if (!row) {
    return null;
  }

  const song = row.song && typeof row.song === 'object'
    ? row.song
    : row;

  const placement = row.placement && typeof row.placement === 'object'
    ? row.placement
    : row;

  const status = safeString(
    song.status ??
    row.song_status ??
    row.status,
    'practice'
  );

  return {
    instanceId: safeString(
      row.set_song_id ??
      placement.id ??
      row.id
    ),
    songId: safeString(
      placement.song_id ??
      row.song_id ??
      song.id
    ),
    setId:
      placement.set_id ??
      row.set_id ??
      null,
    position: safeNumber(
      placement.position ??
      row.position,
      0
    ),
    notes:
      placement.notes ??
      row.placement_notes ??
      null,

    title: safeString(
      song.title ??
      row.title,
      'Untitled Song'
    ),
    artist: safeString(
      song.artist ??
      row.artist,
      'Unknown Artist'
    ),
    durationSeconds: safeNumber(
      song.duration_seconds ??
      song.durationSeconds ??
      row.duration_seconds,
      0
    ),
    videoUrl:
      song.video_url ??
      song.videoUrl ??
      row.video_url ??
      null,
    tags: safeTags(
      song.tags ??
      row.tags
    ),
    rating: safeNullableNumber(
      song.rating ??
      row.rating
    ),
    playedLive: Boolean(
      song.played_live ??
      song.playedLive ??
      false
    ),
    guitarLessonUrl:
      song.guitar_url ??
      song.guitar_lesson_url ??
      song.guitarLessonUrl ??
      row.guitar_url ??
      null,
    bassLessonUrl:
      song.bass_url ??
      song.bass_lesson_url ??
      song.bassLessonUrl ??
      row.bass_url ??
      null,
    lyricsUrl:
      song.lyrics_url ??
      song.lyricsUrl ??
      row.lyrics_url ??
      null,
    generalNotes:
      song.notes ??
      song.general_notes ??
      song.generalNotes ??
      row.song_notes ??
      null,
    practiceStatus: displayStatus(status, 'practice')
  };
}