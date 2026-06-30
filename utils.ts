import { Song, SetList, GigDetails, PDFOptions, BandSettings } from './types';
import { v4 as uuidv4 } from 'uuid';
import { jsPDF } from "jspdf";
import autoTable from 'jspdf-autotable';

/**
 * Parses a duration string (e.g., "3:45", "1:05:20") into total seconds.
 */
export const parseDurationToSeconds = (durationStr: string): number => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(part => parseInt(part, 10));
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else {
    return parts[0]; 
  }
};

/**
 * Formats seconds into a readable string (e.g., "3:45", "1h 5m").
 */
export const formatDuration = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const formatDurationHuman = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  
  if (h > 0) return `${h}hr ${m}min`;
  return `${m} min`;
};

/**
 * Extracts Youtube Video ID from URL
 */
export const extractYoutubeId = (url: string | undefined): string | null => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

/**
 * Transforms a generic Google Sheets URL (Edit/View) into a CSV Export URL.
 * Handles 'gid' parameters to ensure the correct sheet tab is exported.
 */
export const transformGoogleSheetUrl = (url: string): string => {
    if (!url) return '';
    if (url.includes('docs.google.com/spreadsheets')) {
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match) {
            const id = match[1];
            const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
            const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
            return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gidParam}`;
        }
    }
    return url;
};

/**
 * Generates a CSV blob from songs - Updated for all fields
 */
export const generateCSV = (songs: Song[]): string => {
  const headers = [
      'Title', 'Artist', 'Duration (Seconds)', 'Video URL', 
      'Rating', 'Played Live', 
      'Guitar Lesson', 'Bass Lesson', 'Lyrics', 
      'Status', 'General Notes'
  ];
  const rows = songs.map(song => [
    `"${song.title.replace(/"/g, '""')}"`,
    `"${song.artist.replace(/"/g, '""')}"`,
    song.durationSeconds,
    song.videoUrl || '',
    song.rating || '',
    song.playedLive ? 'Yes' : 'No',
    song.guitarLessonUrl || '',
    song.bassLessonUrl || '',
    song.lyricsUrl || '',
    song.practiceStatus || 'Ready',
    `"${(song.generalNotes || '').replace(/"/g, '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};



export const parseCSV = (text: string): Song[] => {
  const normalizedText = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = normalizedText
    .split('\n')
    .filter(line => line.trim());

  if (lines.length < 2) {
    return [];
  }

  const isTabDelimited = lines[0].includes('\t');
  const delimiter = isTabDelimited ? '\t' : ',';

  const parseRow = (row: string): string[] => {
    if (delimiter === '\t') {
      return row
        .split('\t')
        .map(value => value.trim());
    }

    const values: string[] = [];
    let current = '';
    let insideQuotes = false;

    for (let index = 0; index < row.length; index++) {
      const character = row[index];

      if (character === '"') {
        if (
          insideQuotes &&
          row[index + 1] === '"'
        ) {
          current += '"';
          index++;
        } else {
          insideQuotes = !insideQuotes;
        }

        continue;
      }

      if (
        character === ',' &&
        !insideQuotes
      ) {
        values.push(current.trim());
        current = '';
        continue;
      }

      current += character;
    }

    values.push(current.trim());

    return values;
  };

  const headers = parseRow(lines[0]).map(header =>
    header
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  );

  const importedSongs: Song[] = [];

  for (
    let lineIndex = 1;
    lineIndex < lines.length;
    lineIndex++
  ) {
    const values = parseRow(lines[lineIndex]);

    const song: Song = {
      id: uuidv4(),
      externalId: null,
      title: '',
      artist: '',
      durationSeconds: 0,
      videoUrl: null,
      tags: [],
      rating: null,
      playedLive: false,
      guitarLessonUrl: null,
      bassLessonUrl: null,
      lyricsUrl: null,
      generalNotes: null,
      practiceStatus: 'Ready',
      active: true
    };

    headers.forEach((header, columnIndex) => {
      const value =
        values[columnIndex]?.trim() || '';

      if (
        header === 'title' ||
        header === 'song' ||
        header === 'song title'
      ) {
        song.title = value;
      } else if (
        header === 'artist' ||
        header === 'band'
      ) {
        song.artist = value;
      } else if (
        header.includes('duration') ||
        header === 'time' ||
        header.includes('length')
      ) {
        song.durationSeconds =
          parseDurationToSeconds(value);
      } else if (
        header.includes('video') ||
        header === 'url' ||
        header === 'link'
      ) {
        song.videoUrl = value || null;
      } else if (
        header.includes('rating')
      ) {
        const rating =
          Number.parseInt(value, 10);

        song.rating =
          Number.isFinite(rating) &&
          rating >= 1 &&
          rating <= 5
            ? rating
            : null;
      } else if (
        header.includes('played live') ||
        header === 'live'
      ) {
        const normalized =
          value.toLowerCase();

        song.playedLive =
          normalized === 'yes' ||
          normalized === 'true' ||
          normalized === '1';
      } else if (
        header.includes('guitar')
      ) {
        song.guitarLessonUrl =
          value || null;
      } else if (
        header.includes('bass')
      ) {
        song.bassLessonUrl =
          value || null;
      } else if (
        header.includes('lyrics')
      ) {
        song.lyricsUrl =
          value || null;
      } else if (
        header.includes('status')
      ) {
        song.practiceStatus =
          value.toLowerCase().includes(
            'practice'
          )
            ? 'Practice'
            : 'Ready';
      } else if (
        header.includes('note')
      ) {
        song.generalNotes =
          value || null;
      } else if (
        header.includes('tag')
      ) {
        song.tags = value
          .split(/[;,]/)
          .map(tag => tag.trim())
          .filter(Boolean);
      } else if (
        header.includes('external')
      ) {
        song.externalId =
          value || null;
      }
    });

    song.title = song.title.trim();
    song.artist =
      song.artist.trim() ||
      'Unknown Artist';

    song.tags = Array.isArray(song.tags)
      ? song.tags
      : [];

    song.durationSeconds =
      Number.isFinite(
        Number(song.durationSeconds)
      )
        ? Math.max(
            0,
            Number(song.durationSeconds)
          )
        : 0;

    if (song.title) {
      importedSongs.push(song);
    }
  }

  return importedSongs;
};











/**
 * Parses Band Profile CSV/TSV
 * Handles: Band Name, Band Logo URL, Band Member 1...N
 */
export const parseBandProfileCSV = (text: string): Partial<BandSettings> => {
    if (!text?.trim()) return {};
  
    // If Google returns HTML (permissions / login), bail
    const t = text.trim();
    if (t.startsWith("<!DOCTYPE html") || t.startsWith("<html")) return {};
  
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(l => l.trimEnd())
      .filter(Boolean);
  
    if (lines.length < 2) return {};
  
    // Detect delimiter: Google "copy/paste" is usually TSV (tabs), export is CSV (commas)
    const headerLine = lines[0];
    const delimiter = headerLine.includes("\t") ? "\t" : ",";
  
    const splitTSV = (row: string) => row.split("\t").map(s => s.trim());
  
    // Minimal CSV parser that supports quoted commas
    const splitCSV = (row: string) => {
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
  
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
  
        if (ch === '"') {
          if (inQuotes && row[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
  
        if (ch === "," && !inQuotes) {
          out.push(cur.trim());
          cur = "";
          continue;
        }
  
        cur += ch;
      }
  
      out.push(cur.trim());
      return out.map(v => v.replace(/^"(.*)"$/, "$1").trim());
    };
  
    const splitRow = (row: string) => (delimiter === "\t" ? splitTSV(row) : splitCSV(row));
  
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  
    const headers = splitRow(lines[0]).map(normalize);
    const values = splitRow(lines[1]);
  
    const get = (headerName: string) => {
      const idx = headers.findIndex(h => h.includes(normalize(headerName)));
      if (idx === -1) return "";
      return (values[idx] || "").trim();
    };
  
    const name = get("Band Name");
    const logoUrl = get("Band Logo URL") || get("Logo URL");
  
    // New format: Band Member 1..N
    const members: string[] = [];
    headers.forEach((h, i) => {
      if (h.includes("band member") || h.includes("member")) {
        const v = (values[i] || "").trim();
        // Avoid adding the header row if parsing logic fails, though we are looking at values index
        if (v && v.toLowerCase() !== 'band members') members.push(v);
      }
    });
  
    // Fallback: old single "Band Members" column (comma separated)
    if (members.length === 0) {
      const legacy = get("Band Members");
      if (legacy) {
        legacy
          .split(/[,\n]/g)
          .map(s => s.trim())
          .filter(Boolean)
          .forEach(m => members.push(m));
      }
    }
  
    const result: Partial<BandSettings> = {};
    if (name) result.name = name;
    if (logoUrl) result.logoUrl = logoUrl;
    if (members.length > 0) result.members = members;
  
    return result;
};

// --- Helper Functions for Data Normalization ---

const toISODate = (raw: string): string => {
  const s = (raw || "").trim();
  if (!s) return "";

  // already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  
  // Try Date.parse as fallback (e.g. for "Feb 28, 2026")
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
      // Return YYYY-MM-DD
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
  }

  return "";
};

const to24hTime = (raw: string): string => {
  const s = (raw || "").trim();
  if (!s) return "";

  // already 24h HH:MM
  if (/^\d{1,2}:\d{2}$/.test(s)) {
      // Ensure leading zero if needed (e.g. 9:00 -> 09:00)
      const parts = s.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1]}`;
  }

  // h:mm AM/PM (case-insensitive)
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = m[3].toUpperCase();

    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;

    return `${String(h).padStart(2, "0")}:${min}`;
  }

  return "";
};

/**
 * Parses Gig Details CSV/TSV
 */
export const parseGigDetailsCSV = (text: string): Partial<GigDetails> => {
    if (!text?.trim()) return {};
  
    const t = text.trim();
    if (t.startsWith("<!DOCTYPE html") || t.startsWith("<html")) return {};
  
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(l => l.trimEnd())
      .filter(Boolean);
  
    if (lines.length < 2) return {};
  
    const headerLine = lines[0];
    const delimiter = headerLine.includes("\t") ? "\t" : ",";
  
    const splitTSV = (row: string) => row.split("\t").map(s => s.trim());
  
    const splitCSV = (row: string) => {
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
  
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
  
        if (ch === '"') {
          if (inQuotes && row[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
  
        if (ch === "," && !inQuotes) {
          out.push(cur.trim());
          cur = "";
          continue;
        }
  
        cur += ch;
      }
  
      out.push(cur.trim());
      return out.map(v => v.replace(/^"(.*)"$/, "$1").trim());
    };
  
    const splitRow = (row: string) => (delimiter === "\t" ? splitTSV(row) : splitCSV(row));
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  
    const headers = splitRow(lines[0]).map(normalize);
    const values = splitRow(lines[1]);
  
    const get = (headerName: string) => {
      const idx = headers.findIndex(h => h.includes(normalize(headerName)));
      if (idx === -1) return "";
      return (values[idx] || "").trim();
    };
  
    const result: Partial<GigDetails> = {};
    
    const name = get("Gig Name");
    if (name) result.name = name;
    
    const location = get("Location");
    if (location) result.location = location;

    const date = get("Date");
    if (date) result.date = toISODate(date);

    const arrive = get("Arrive Time");
    if (arrive) result.arriveTime = to24hTime(arrive);

    const start = get("Start Time");
    if (start) result.startTime = to24hTime(start);
    
    const notes = get("Notes");
    if (notes) result.notes = notes;
  
    return result;
};

// Generate Time Options from Noon to 11PM in 30m increments
export const generateTimeOptions = () => {
    const times = [];
    for (let hour = 12; hour <= 23; hour++) {
        const h = hour; // 24hr format for value
        const displayH = hour > 12 ? hour - 12 : hour;
        const ampm = hour >= 12 ? 'PM' : 'AM'; // Loop starts at 12, so always PM except maybe if we extended range
        
        times.push({ value: `${h.toString().padStart(2, '0')}:00`, label: `${displayH}:00 ${ampm}` });
        times.push({ value: `${h.toString().padStart(2, '0')}:30`, label: `${displayH}:30 ${ampm}` });
    }
    return times;
};

// Helper to load image for PDF
const loadImage = (url: string): Promise<string | null> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous'; 
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                try {
                    ctx.drawImage(img, 0, 0);
                    const dataURL = canvas.toDataURL('image/png');
                    resolve(dataURL);
                } catch (e) {
                    console.error("Canvas taint error - Image likely blocked by CORS", e);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        };
        
        img.onerror = (e) => {
            console.error("Failed to load image", url, e);
            resolve(null);
        };
        
        img.src = url;
    });
};

export const generatePDFDoc = async (
    sets: SetList[], 
    gigDetails: GigDetails, 
    options: PDFOptions,
    bandSettings?: BandSettings
) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let yPos = 20;

    // --- Header ---
    if (options.includeLogo && bandSettings?.logoUrl) {
        try {
            const logoData = await loadImage(bandSettings.logoUrl);
            if (logoData) {
                // Adjust logo size and position
                doc.addImage(logoData, 'PNG', 14, 10, 25, 25, undefined, 'FAST');
                yPos = 40; 
            }
        } catch (e) {
            console.error("Failed to add logo to PDF", e);
        }
    }

    const titleX = (options.includeLogo && bandSettings?.logoUrl) ? 45 : 14;
    
    doc.setFontSize(22);
    // Use Gig Name or Band Name if Gig Name is missing
    const headerTitle = gigDetails.name || bandSettings?.name || "Set List";
    doc.text(headerTitle, titleX, (options.includeLogo && bandSettings?.logoUrl) ? 20 : 20);
    
    let currentHeaderY = (options.includeLogo && bandSettings?.logoUrl) ? 28 : 28;

    if (options.includeGigInfo) {
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.setFont("helvetica", "normal");
        const details = [
            gigDetails.location && `Location: ${gigDetails.location}`,
            gigDetails.date && `Date: ${gigDetails.date}`,
            gigDetails.arriveTime && `Arrive: ${gigDetails.arriveTime}`,
            gigDetails.startTime && `Start: ${gigDetails.startTime}`
        ].filter(Boolean).join(' | ');
        
        doc.text(details, titleX, currentHeaderY);
        currentHeaderY += 6;
    }

    // Include Gig Notes if present
    if (options.includeGigInfo && gigDetails.notes) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(80);
        
        // Wrap text to avoid overflow
        const maxNoteWidth = pageWidth - titleX - 14;
        const splitNotes = doc.splitTextToSize(gigDetails.notes, maxNoteWidth);
        doc.text(splitNotes, titleX, currentHeaderY);
        
        currentHeaderY += (splitNotes.length * 4) + 2; 
    }
    
    // Ensure the set list table starts below the header content
    if (yPos < currentHeaderY + 10) {
        yPos = currentHeaderY + 10;
    } else if (yPos < 35) {
        yPos = 35; // Minimum top margin
    }

    // --- Sets ---
    for (let i = 0; i < sets.length; i++) {
        const set = sets[i];
        
        // Page Break Logic
        if (options.oneSetPerPage && i > 0) {
            doc.addPage();
            yPos = 20;
        } else if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        const totalDuration = set.songs.reduce((acc, s) => acc + s.durationSeconds, 0);
        
        doc.setFontSize(options.largeType ? 18 : 14);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        
        const setName = set.name || `Set ${i + 1}`;
        doc.text(`${setName} (${formatDurationHuman(totalDuration)})`, 14, yPos);
        yPos += options.largeType ? 8 : 5;

        // Table Columns
        const head = [['#', 'Song', 'Artist', 'Time']];
        if (options.includeNotes) head[0].push('Notes');

        const body = set.songs.map((s, idx) => {
            const row = [
                idx + 1,
                s.title,
                s.artist,
                formatDuration(s.durationSeconds)
            ];
            if (options.includeNotes) {
                const notes = [s.notes, s.generalNotes].filter(Boolean).join(' | ');
                row.push(notes);
            }
            return row;
        });

        autoTable(doc, {
            startY: yPos,
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [99, 102, 241], fontSize: options.largeType ? 14 : 10 },
            bodyStyles: { fontSize: options.largeType ? 12 : 9 },
            styles: { 
                cellPadding: options.largeType ? 3 : 2 
            },
            columnStyles: {
                0: { cellWidth: options.largeType ? 15 : 10 },
                1: { fontStyle: 'bold' },
                3: { cellWidth: options.largeType ? 25 : 20 },
                4: { cellWidth: 'auto', fontStyle: 'italic', textColor: [100, 100, 100] }
            },
            margin: { left: 14, right: 14 }
        });

        // @ts-ignore
        yPos = doc.lastAutoTable.finalY + 15;
    }

    doc.save(`${gigDetails.name || 'SetList'}.pdf`);
};

export const MOCK_SONGS: Song[] = [
  { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', durationSeconds: 355, videoUrl: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ', rating: 5, playedLive: true, practiceStatus: 'Ready', tags: [], active: true },
  { id: '2', title: 'Hotel California', artist: 'Eagles', durationSeconds: 390, videoUrl: 'https://www.youtube.com/watch?v=EqPtz5qN7HM', rating: 4, playedLive: true, practiceStatus: 'Ready', tags: [], active: true },
  { id: '3', title: 'Sweet Child O\' Mine', artist: 'Guns N\' Roses', durationSeconds: 356, videoUrl: 'https://www.youtube.com/watch?v=1w7OgIMMRc4', rating: 5, playedLive: false, practiceStatus: 'Practice', tags: [], active: true },
  { id: '4', title: 'Stairway to Heaven', artist: 'Led Zeppelin', durationSeconds: 482, videoUrl: 'https://www.youtube.com/watch?v=xbhCPt6PZIU', rating: 5, playedLive: false, practiceStatus: 'Practice', tags: [], active: true },
  { id: '5', title: 'Smells Like Teen Spirit', artist: 'Nirvana', durationSeconds: 301, videoUrl: 'https://www.youtube.com/watch?v=hTWKbfoikeg', rating: 4, playedLive: true, practiceStatus: 'Ready', tags: [], active: true },
];