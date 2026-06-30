import React, { useState, useMemo, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Song, SetList } from '../types';
import { Icons } from './ui/Icons';
import { formatDuration, generateCSV } from '../utils';

interface SongLibraryProps {
  songs: Song[];
  sets: SetList[];
  usage: Record<string, {setId: string, setNumber: number, setName: string, count: number}[]>; 
  onImportClick: () => void;
  onPlaySong: (song: Song) => void;
  onUpdateSong: (song: Song) => void;
  onClearLibrary: () => void;
  onEditSong: (song: Song) => void;
  onAddSongToSet: (song: Song, targetSetId: string) => void;
}

const RatingStars = ({ count }: { count?: number | null }) => (
  <div className="flex text-yellow-500">
    {[1, 2, 3, 4, 5].map((i) => (
      <Icons.Star 
        key={i} 
        size={10} 
        className={i <= (count || 0) ? 'fill-current' : 'text-zinc-700 fill-zinc-800'} 
      />
    ))}
  </div>
);

const DraggableLibrarySong: React.FC<{ 
  song: Song; 
  usageList: {setId: string, setNumber: number, setName: string, count: number}[]; 
  viewOptions: { showRating: boolean, showLive: boolean };
  onPlay: () => void;
  onEdit: () => void;
  onAdd: () => void;
  destinationSetName: string;
}> = ({ song, usageList, viewOptions, onPlay, onEdit, onAdd, destinationSetName }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lib-${song.id}`,
    data: { type: 'LIBRARY_SONG', data: song },
  });

  const isUsed = usageList && usageList.length > 0;
  // Use practice status for stripe
  const isPractice = song.practiceStatus === 'Practice';

  return (
    <div
      ref={setNodeRef}
      className={`group relative p-3 rounded-lg border transition-all mb-2 overflow-hidden
        ${isUsed ? 'bg-zinc-900/50 border-white/5 opacity-80' : 'bg-surfaceHighlight border-white/5 hover:border-primary/30'}
        ${isDragging ? 'opacity-50 grayscale' : ''}
      `}
    >
      {/* Warning Stripe for Practice Status */}
      {isPractice && (
        <div 
            className="absolute top-0 left-0 right-0 h-1 z-10"
            style={{ 
                backgroundImage: 'repeating-linear-gradient(45deg, #eab308, #eab308 10px, #ca8a04 10px, #ca8a04 20px)' 
            }}
            title="Needs Practice"
        ></div>
      )}

      <div className="flex items-start justify-between mt-1">
          <div className="flex-1 min-w-0 pr-2">
            {/* Title & Grip */}
            <div className="flex items-center gap-2 mb-1">
                <div 
                    {...listeners} 
                    {...attributes} 
                    className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300"
                >
                    <Icons.Grip size={14} />
                </div>
                <div className={`font-semibold text-sm truncate flex items-center gap-2 ${isUsed ? 'text-zinc-500' : 'text-zinc-200'}`}>
                    {song.title}
                    {song.practiceStatus === 'Ready' && <span className="w-2 h-2 rounded-full bg-green-500" title="Ready"></span>}
                </div>
            </div>
            
            {/* Artist */}
            <div className="text-xs text-zinc-500 truncate pl-6 mb-2">{song.artist}</div>

            {/* Badges/Metadata */}
            <div className="pl-6 flex flex-wrap gap-2 items-center">
                 <span className="text-[10px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-zinc-400 border border-white/5">
                    {formatDuration(song.durationSeconds)}
                 </span>

                 {viewOptions.showRating && (
                    <div className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded border border-white/5" title="Rating">
                        <RatingStars count={song.rating} />
                    </div>
                 )}

                 {viewOptions.showLive && song.playedLive && (
                     <span className="text-[10px] font-bold text-green-500 flex items-center gap-1 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                         <Icons.Check size={8} /> Live
                     </span>
                 )}
            </div>
             
             {/* Used In Sets Badges */}
             {isUsed && (
                <div className="pl-6 mt-2 flex flex-wrap gap-1">
                    {usageList.map((usageItem, i) => {
                        const countSuffix = usageItem.count > 1 ? ` ×${usageItem.count}` : '';
                        return (
                            <span 
                                key={i} 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const el = document.getElementById(`set-col-${usageItem.setId}`);
                                    if (el) {
                                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        el.classList.add('ring-2', 'ring-primary');
                                        setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1500);
                                    }
                                }}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/20 text-primary border border-primary/20 hover:bg-primary/40 hover:text-white transition-colors cursor-pointer"
                                title={`Click to scroll to ${usageItem.setName}`}
                            >
                                S{usageItem.setNumber}{countSuffix}
                            </span>
                        );
                    })}
                </div>
            )}
          </div>
          
          {/* Actions Column */}
          <div className="flex flex-col gap-2 shrink-0">
               <button 
                onClick={(e) => { e.stopPropagation(); onAdd(); }}
                className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors border border-primary/20"
                title={`Add to ${destinationSetName}`}
                data-no-dnd="true"
               >
                   <Icons.Plus size={16} />
               </button>

               <button 
                onClick={(e) => { e.stopPropagation(); onPlay(); }}
                className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-red-500 transition-colors"
                title="Play Video"
                data-no-dnd="true"
               >
                   <Icons.Play size={16} />
               </button>
               <button 
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-blue-400 transition-colors"
                title="Details & Edit"
                data-no-dnd="true"
               >
                   <Icons.Info size={16} />
               </button>
          </div>
      </div>
    </div>
  );
};

export const SongLibrary: React.FC<SongLibraryProps> = ({
  songs,
  sets,
  usage,
  onImportClick,
  onPlaySong,
  onUpdateSong,
  onClearLibrary,
  onEditSong,
  onAddSongToSet
}) => {
  const safeUsage =
    usage && typeof usage === 'object'
      ? usage
      : {};

  const [search, setSearch] = useState('');
  const [artistFilter, setArtistFilter] = useState('');
  const [sortBy, setSortBy] = useState<'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc' | 'duration-asc' | 'duration-desc'>('title-asc');
  
  const [viewOptions, setViewOptions] = useState({
      showRating: true,
      showLive: true
  });
  const [showViewMenu, setShowViewMenu] = useState(false);

  // New Filters
  const [hideUsed, setHideUsed] = useState(false);
  const [hidePractice, setHidePractice] = useState(false);

  // Destination Set Logic
  const [targetSetId, setTargetSetId] = useState<string>('NEW_SET');

  // Ensure targetSetId is valid when sets change
  useEffect(() => {
    // If currently selected set no longer exists, reset to first set or NEW_SET
    if (targetSetId !== 'NEW_SET' && !sets.find(s => s.id === targetSetId)) {
        setTargetSetId(sets.length > 0 ? sets[0].id : 'NEW_SET');
    }
    // If we have no sets, force NEW_SET
    if (sets.length === 0 && targetSetId !== 'NEW_SET') {
        setTargetSetId('NEW_SET');
    }
  }, [sets, targetSetId]);
  
  // Initialize to first set if available on mount
  useEffect(() => {
      if (targetSetId === 'NEW_SET' && sets.length > 0) {
           setTargetSetId(sets[0].id);
      }
  }, []);

  const targetSetName = useMemo(() => {
      if (targetSetId === 'NEW_SET') {
          return sets.length < 5 ? `Set ${sets.length + 1} (New)` : 'Set List Full';
      }
      return sets.find(s => s.id === targetSetId)?.name || 'Unknown Set';
  }, [targetSetId, sets]);


  // Counters
  const totalSongs = songs.length;
  // Calculate used based on if it exists in safeUsage
  const usedSongsCount = songs.filter(
    s =>
      Array.isArray(safeUsage[s.id]) &&
      safeUsage[s.id].length > 0
  ).length;


  const filteredSongs = useMemo(() => {
    let result = songs.filter(s => {
      const matchesSearch = s.title.toLowerCase().includes(search.toLowerCase());
      const matchesArtist = !artistFilter || s.artist.toLowerCase().includes(artistFilter.toLowerCase());
      
      const isUsed =
        Array.isArray(safeUsage[s.id]) &&
        safeUsage[s.id].length > 0;
      if (hideUsed && isUsed) return false;
      
      const isPractice = s.practiceStatus === 'Practice';
      if (hidePractice && isPractice) return false;

      return matchesSearch && matchesArtist;
    });

    return result.sort((a, b) => {
      switch (sortBy) {
          case 'title-asc': return a.title.localeCompare(b.title);
          case 'title-desc': return b.title.localeCompare(a.title);
          case 'artist-asc': return a.artist.localeCompare(b.artist);
          case 'artist-desc': return b.artist.localeCompare(a.artist);
          case 'duration-asc': return a.durationSeconds - b.durationSeconds;
          case 'duration-desc': return b.durationSeconds - a.durationSeconds;
          default: return 0;
      }
    });
  }, [songs, search, artistFilter, sortBy, hideUsed, hidePractice, safeUsage]);

  const handleExport = () => {
    const csvContent = generateCSV(songs);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "library_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full bg-surface border-l border-white/5 w-[380px] shrink-0">
      <div className="p-4 border-b border-white/5 space-y-4 bg-zinc-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
             <h2 className="text-lg font-semibold text-white tracking-tight">Library</h2>
             <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full" title="Used / Total">
                 {usedSongsCount}/{totalSongs} Used
             </span>
          </div>
          
          <div className="flex items-center gap-2 relative">
             <button 
                onClick={onClearLibrary}
                className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
                title="Clear Library"
             >
                 <Icons.Trash size={16} />
             </button>

             <button 
                onClick={handleExport}
                className="p-2 text-zinc-500 hover:text-green-500 transition-colors"
                title="Export to CSV"
             >
                 <Icons.Sheet size={16} />
             </button>
             
             {/* Gear Menu */}
             <div className="relative">
                <button 
                    onClick={() => setShowViewMenu(!showViewMenu)}
                    className={`p-2 rounded-md transition-colors ${showViewMenu ? 'text-white bg-zinc-800' : 'text-zinc-500 hover:text-white'}`}
                >
                    <Icons.Settings size={18} />
                </button>
                
                {showViewMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 p-2">
                        <div className="text-xs font-semibold text-zinc-500 px-2 py-1 uppercase">View Options</div>
                        <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-800 rounded cursor-pointer text-sm text-zinc-300">
                            <input type="checkbox" checked={viewOptions.showRating} onChange={e => setViewOptions({...viewOptions, showRating: e.target.checked})} className="rounded bg-zinc-700" />
                            Show Ratings
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-800 rounded cursor-pointer text-sm text-zinc-300">
                            <input type="checkbox" checked={viewOptions.showLive} onChange={e => setViewOptions({...viewOptions, showLive: e.target.checked})} className="rounded bg-zinc-700" />
                            Show Live Badge
                        </label>
                        <div className="h-px bg-white/10 my-1"></div>
                        <button onClick={() => { setShowViewMenu(false); onImportClick(); }} className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-zinc-800 rounded flex items-center gap-2">
                            <Icons.Download size={14}/> Import Data
                        </button>
                    </div>
                )}
             </div>
          </div>
        </div>
        
        {/* Quick Destination Select */}
        <div className="flex items-center gap-2 bg-zinc-800/50 p-2 rounded-lg border border-white/5">
            <span className="text-xs text-zinc-400 whitespace-nowrap">Add to:</span>
            <select 
                value={targetSetId}
                onChange={(e) => setTargetSetId(e.target.value)}
                className="w-full bg-black/40 border border-zinc-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-primary"
            >
                {sets.map((s, idx) => (
                    <option key={s.id} value={s.id}>{idx + 1}. {s.name}</option>
                ))}
                {sets.length < 5 && (
                    <option value="NEW_SET" className="text-primary font-bold">+ New Set ({sets.length + 1})</option>
                )}
            </select>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
            <button 
                onClick={() => setHideUsed(!hideUsed)}
                className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium border transition-colors ${hideUsed ? 'bg-primary/20 border-primary text-primary' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
            >
                {hideUsed ? 'Hidden: Added' : 'Hide Added'}
            </button>
            <button 
                onClick={() => setHidePractice(!hidePractice)}
                className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium border transition-colors ${hidePractice ? 'bg-yellow-500/20 border-yellow-500 text-yellow-500' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
            >
                 {hidePractice ? 'Hidden: Practice' : 'Hide Practice'}
            </button>
        </div>

        {/* Search & Filter Inputs */}
        <div className="grid grid-cols-2 gap-2">
            <div className="relative col-span-2">
                 <Icons.Music className="absolute left-3 top-2.5 text-zinc-600" size={14} />
                 <input 
                    type="text" 
                    placeholder="Search Song Title..." 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-background border border-zinc-800 rounded-lg py-2 pl-9 pr-3 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-primary/50"
                 />
            </div>
            
            <div className="relative col-span-1">
                 <input 
                    type="text" 
                    placeholder="Filter Artist..." 
                    value={artistFilter}
                    onChange={(e) => setArtistFilter(e.target.value)}
                    className="w-full bg-background border border-zinc-800 rounded-lg py-2 px-3 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-primary/50"
                 />
            </div>

            <div className="relative col-span-1">
                <select 
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="w-full bg-background border border-zinc-800 rounded-lg py-2 px-2 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 appearance-none"
                >
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="artist-asc">Artist (A-Z)</option>
                    <option value="artist-desc">Artist (Z-A)</option>
                    <option value="duration-asc">Time (Shortest)</option>
                    <option value="duration-desc">Time (Longest)</option>
                </select>
                <Icons.Sort className="absolute right-2 top-2.5 text-zinc-600 pointer-events-none" size={12} />
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {filteredSongs.length === 0 ? (
            <div className="text-center p-8 text-zinc-600">
                <p className="text-sm">No songs found.</p>
                {songs.length === 0 && <p className="text-xs mt-1">Import a CSV or use demo data.</p>}
            </div>
        ) : (
            filteredSongs.map(song => (
            <DraggableLibrarySong 
                key={song.id} 
                song={song} 
                usageList={
                  Array.isArray(safeUsage[song.id])
                    ? safeUsage[song.id]
                    : []
                }
                viewOptions={viewOptions}
                onPlay={() => onPlaySong(song)}
                onEdit={() => onEditSong(song)}
                onAdd={() => onAddSongToSet(song, targetSetId)}
                destinationSetName={targetSetName}
            />
            ))
        )}
      </div>
    </div>
  );
};