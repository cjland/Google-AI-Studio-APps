export function mapBand(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    members: [],
    logoUrl: null,
    defaultLibraryUrl: null,
    bandProfileUrl: null,
    gigDetailsUrl: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapSong(row: any) {
  if (!row) return null;
  const dbStatus = row.status || 'practice';
  const displayStatus = dbStatus.charAt(0).toUpperCase() + dbStatus.slice(1);
  return {
    id: row.id,
    externalId: row.external_id || null,
    title: row.title,
    artist: row.artist || 'Unknown Artist',
    durationSeconds: Number(row.duration_seconds || 0),
    videoUrl: row.video_url || null,
    tags: Array.isArray(row.tags)
      ? row.tags
      : (typeof row.tags === 'string'
        ? (row.tags.startsWith('[') ? JSON.parse(row.tags) : row.tags.split(',').map((s: string) => s.trim()).filter(Boolean))
        : []),
    rating: row.rating ? Number(row.rating) : null,
    playedLive: false,
    guitarLessonUrl: row.guitar_url || null,
    bassLessonUrl: row.bass_url || null,
    lyricsUrl: row.lyrics_url || null,
    generalNotes: row.notes || null,
    practiceStatus: displayStatus,
    active: dbStatus !== 'inactive',
  };
}

export function mapGig(row: any) {
  if (!row) return null;
  const dbStatus = row.status || 'draft';
  const displayStatus = dbStatus.charAt(0).toUpperCase() + dbStatus.slice(1);
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    gigDate: row.gig_date || '',
    startTime: row.start_time || '',
    arriveTime: row.arrival_time || '',
    notes: row.notes || '',
    status: displayStatus,
    bandId: row.band_id,
    setCount: row.set_count !== undefined ? Number(row.set_count) : undefined,
    songCount: row.song_count !== undefined ? Number(row.song_count) : undefined,
    totalDurationSeconds: row.total_duration_seconds !== undefined ? Number(row.total_duration_seconds) : undefined,
  };
}

export function mapGigSet(row: any) {
  if (!row) return null;
  const dbStatus = row.status || 'draft';
  const displayStatus = dbStatus.charAt(0).toUpperCase() + dbStatus.slice(1);
  return {
    id: row.id,
    gigId: row.gig_id,
    name: row.name,
    setNumber: Number(row.set_number),
    sortOrder: Number(row.sort_order),
    color: '',
    status: displayStatus,
    targetDurationSeconds: row.target_duration_seconds !== null && row.target_duration_seconds !== undefined
      ? Number(row.target_duration_seconds)
      : undefined,
    songs: [],
  };
}

export function mapSetSongPlacement(row: any) {
  if (!row) return null;
  const dbStatus = row.status || 'practice';
  const displayStatus = dbStatus.charAt(0).toUpperCase() + dbStatus.slice(1);
  return {
    instanceId: row.set_song_id || row.id,
    songId: row.song_id,
    setId: row.set_id || null,
    position: Number(row.position),
    notes: row.notes || null,

    title: row.title,
    artist: row.artist || 'Unknown Artist',
    durationSeconds: Number(row.duration_seconds || 0),
    videoUrl: row.video_url || null,
    tags: Array.isArray(row.tags)
      ? row.tags
      : (typeof row.tags === 'string'
        ? (row.tags.startsWith('[') ? JSON.parse(row.tags) : row.tags.split(',').map((s: string) => s.trim()).filter(Boolean))
        : []),
    rating: row.rating ? Number(row.rating) : null,
    playedLive: false,
    guitarLessonUrl: row.guitar_url || null,
    bassLessonUrl: row.bass_url || null,
    lyricsUrl: row.lyrics_url || null,
    generalNotes: row.song_notes || null,
    practiceStatus: displayStatus,
  };
}
