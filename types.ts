
export interface Song {
  id: string;
  externalId?: string | null;
  title: string;
  artist: string;
  durationSeconds: number;
  videoUrl?: string | null;
  tags: string[];
  rating?: number | null;
  playedLive: boolean;
  guitarLessonUrl?: string | null;
  bassLessonUrl?: string | null;
  lyricsUrl?: string | null;
  generalNotes?: string | null;
  practiceStatus?: 'Practice' | 'Ready' | null;
  active: boolean;
}

export interface SetSong {
  instanceId: string;
  songId: string;
  setId?: string;
  position: number;
  notes?: string | null;

  title: string;
  artist: string;
  durationSeconds: number;
  videoUrl?: string | null;
  tags: string[];
  rating?: number | null;
  playedLive: boolean;
  guitarLessonUrl?: string | null;
  bassLessonUrl?: string | null;
  lyricsUrl?: string | null;
  generalNotes?: string | null;
  practiceStatus?: 'Practice' | 'Ready' | null;
}

export type SetStatus = 'Draft' | 'Final' | 'Proposed';

export interface SetList {
  id: string;
  name: string;
  setNumber?: number;
  songs: SetSong[];
  color?: string; // For visual distinction
  status?: SetStatus;
  targetDurationSeconds?: number | null;
}

export interface DragItem {
  type: 'LIBRARY_SONG' | 'SET_SONG' | 'SET_COLUMN';
  id: string;
  data: Song | SetSong | SetList;
  originSetId?: string; // If moving from a set
}

export interface GigDetails {
  name: string;
  location: string;
  date: string;
  startTime: string;
  arriveTime?: string;
  notes?: string;
  // bandLogoUrl moved to BandSettings
}

export interface BandSettings {
    name: string;
    logoUrl: string;
    members: string[]; // List of names
    defaultLibraryUrl?: string;
    gigDetailsUrl?: string;
    bandProfileUrl?: string;
}

export interface PDFOptions {
  includeNotes: boolean;
  oneSetPerPage: boolean;
  largeType: boolean;
  includeLogo: boolean;
  includeGigInfo: boolean;
}

// For parsing CSV
export interface CSVRow {
  Title: string;
  Artist: string;
  Duration: string;
  Link?: string;
  Notes?: string;
  [key: string]: any;
}