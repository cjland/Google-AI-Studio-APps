import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SetList, SetSong, SetStatus, Song } from '../types';
import { Icons } from './ui/Icons';
import { formatDuration, formatDurationHuman } from '../utils';

interface SetListColumnProps {
  setList: SetList;
  setIndex: number;
  totalSets: number;
  bandMembers?: string[];
  duplicateSongIds: string[];
  onRemoveSet: (id: string) => void;
  onRemoveSong: (setId: string, songInstanceId: string) => void;
  onUpdateNote: (setId: string, songInstanceId: string, note: string) => void;
  onPlaySong: (song: SetSong) => void;
  onUpdateSetDetails: (setId: string, updates: Partial<SetList>) => void;
  onEditSong: (song: Song) => void;
  onAddSongToSet: (songId: string, setId: string) => void;
}

interface SortableSetSongProps {
  song: SetSong;
  setId: string;
  index: number;
  isDuplicate: boolean;
  onRemove: () => void;
  onUpdateNote: (note: string) => void;
  onPlay: () => void;
  onEdit: () => void;
}

const SortableSetSong: React.FC<SortableSetSongProps> = ({ song, setId, index, isDuplicate, onRemove, onUpdateNote, onPlay, onEdit }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: song.instanceId,
    data: { type: 'SET_SONG', data: song, originSetId: setId }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const [isEditingNote, setIsEditingNote] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState(song.notes || '');

  // Construct tooltip content
  const tooltipContent = [
    song.title,
    song.notes ? `Note: ${song.notes}` : '',
    song.generalNotes ? `General: ${song.generalNotes}` : ''
  ].filter(Boolean).join('\n');

  const isPractice = song.practiceStatus === 'Practice';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative p-2 mb-2 bg-surfaceHighlight border rounded-lg transition-colors overflow-hidden ${isDuplicate ? 'border-yellow-600/50' : 'border-white/5 hover:border-primary/30'}`}
      title={tooltipContent}
      onClick={(e) => {
         if (!isEditingNote && !(e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('input')) {
             // Optional: onPlay(); 
         }
      }}
    >
      {/* Practice Stripe */}
      {isPractice && (
        <div 
            className="absolute top-0 left-0 right-0 h-1 z-10"
            style={{ 
                backgroundImage: 'repeating-linear-gradient(45deg, #eab308, #eab308 10px, #ca8a04 10px, #ca8a04 20px)' 
            }}
            title="Needs Practice"
        ></div>
      )}

      <div className="flex items-start gap-2 mt-1">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-300 mt-0.5">
          <Icons.Grip size={16} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
             <div className="flex items-center gap-2 overflow-hidden min-w-0">
                <h4 className="font-medium text-sm text-zinc-200 truncate group-hover:text-white transition-colors">
                    {index + 1}. {song.title}
                </h4>
                {isDuplicate && (
                    <div title="Song appears in multiple sets" className="shrink-0 flex items-center">
                        <Icons.Duplicate size={12} className="text-yellow-500" />
                    </div>
                )}
             </div>
             
             <div className="flex items-center gap-2 shrink-0">
                 {/* Time with dark background */}
                <span className="text-[10px] font-mono font-bold text-zinc-400 bg-black/60 px-1.5 py-0.5 rounded border border-white/5">
                    {formatDuration(song.durationSeconds)}
                </span>
                
                {/* Action Icons - Horizontal Row */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onPlay(); }}
                        className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors"
                        title="Play Video"
                    >
                        <Icons.Play size={14} />
                    </button>
                    <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                        className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-blue-400 transition-colors"
                        title="Song Info"
                    >
                        <Icons.Info size={14} />
                    </button>
                    {!song.notes && !isEditingNote && (
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setIsEditingNote(true); }}
                            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-secondary transition-colors"
                            title="Add Note"
                        >
                            <Icons.File size={14} />
                        </button>
                    )}
                    <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        className="p-1 text-zinc-400 hover:text-accent hover:bg-zinc-700 rounded-md transition-colors"
                        title="Remove from set"
                    >
                        <Icons.Trash size={14} />
                    </button>
                </div>
             </div>
          </div>
          
          <p className="text-xs text-zinc-500 truncate">{song.artist}</p>

          {/* Quick Edit Note Area */}
          <div className="mt-1 min-h-[16px]">
              {isEditingNote ? (
                   <input
                        type="text"
                        autoFocus
                        value={noteDraft}
                        placeholder="Add note..."
                        className="w-full text-xs bg-black/30 border border-primary/50 rounded px-1.5 py-0.5 text-white outline-none"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onBlur={() => {
                            onUpdateNote(noteDraft);
                            setIsEditingNote(false);
                        }}
                        onKeyDown={(e) => {
                            if(e.key === 'Enter') {
                                onUpdateNote(noteDraft);
                                setIsEditingNote(false);
                            }
                        }}
                    />
              ) : (
                  song.notes && (
                      <div 
                        onClick={(e) => { e.stopPropagation(); setIsEditingNote(true); }}
                        className="text-xs text-secondary italic cursor-pointer hover:underline truncate"
                        title="Click to edit note"
                      >
                          {song.notes}
                      </div>
                  )
              )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SetListColumn: React.FC<SetListColumnProps> = ({ 
  setList, 
  setIndex, 
  totalSets, 
  bandMembers = [],
  duplicateSongIds,
  onRemoveSet, 
  onRemoveSong,
  onUpdateNote,
  onPlaySong,
  onUpdateSetDetails,
  onEditSong,
  onAddSongToSet
}) => {
  // Sortable Logic for the Column itself
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isColumnDragging
  } = useSortable({
    id: setList.id,
    data: { type: 'SET_COLUMN', data: setList }
  });

  const style = {
      transform: CSS.Translate.toString(transform),
      transition,
      opacity: isColumnDragging ? 0.5 : 1,
  };

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: setList.id,
    data: { type: 'SET', data: setList }
  });

  const [dragOverSetId, setDragOverSetId] = useState<string | null>(null);

  const totalDuration = setList.songs.reduce((acc, s) => acc + s.durationSeconds, 0);

  const getStatusColor = (s?: SetStatus) => {
      switch(s) {
          case 'Final': return 'text-green-500 border-green-500/30 bg-green-500/10';
          case 'Proposed': return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
          default: return 'text-zinc-500 border-zinc-700 bg-zinc-800';
      }
  };

  return (
    <div 
        id={`set-col-${setList.id}`}
        ref={setSortableRef} 
        style={style} 
        onDragOver={event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragEnter={event => {
          event.preventDefault();
          setDragOverSetId(setList.id);
        }}
        onDragLeave={event => {
          if (event.currentTarget === event.target) {
            setDragOverSetId(null);
          }
        }}
        onDrop={event => {
          event.preventDefault();
          setDragOverSetId(null);

          try {
            const raw = event.dataTransfer.getData('application/x-setlist-song');

            if (raw) {
              const payload = JSON.parse(raw);

              if (payload?.source === 'library' && payload?.songId) {
                onAddSongToSet(payload.songId, setList.id);
                return;
              }
            }

            const fallbackSongId = event.dataTransfer.getData('text/plain');

            if (fallbackSongId) {
              onAddSongToSet(fallbackSongId, setList.id);
            }
          } catch (error) {
            console.error('Library song drop failed', error);
          }
        }}
        className={`flex flex-col h-full min-w-[320px] max-w-[400px] w-full bg-surface rounded-xl border shadow-xl overflow-hidden relative transition-colors ${
          dragOverSetId === setList.id
            ? 'border-primary bg-primary/5'
            : 'border-white/5'
        }`}
    >
      {/* Set Header */}
      <div className="border-b border-white/5 bg-gradient-to-r from-surface to-surfaceHighlight">
        <div className="flex items-center gap-3 p-3">
            {/* Drag Handle */}
            <div 
                {...attributes} 
                {...listeners}
                className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-300 p-1 flex-shrink-0"
                title="Drag to reorder sets"
            >
                <Icons.Grip size={20} />
            </div>

            {/* Set Index Badge */}
             <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/20 text-primary text-sm font-bold border border-primary/20 shrink-0 select-none">
                {setIndex + 1}
            </div>

            {/* Name Input */}
            <div className="flex-1 min-w-0">
                <input 
                    list={`band-members-${setList.id}`}
                    type="text"
                    value={setList.name}
                    onChange={(e) => onUpdateSetDetails(setList.id, { name: e.target.value })}
                    className="bg-transparent font-bold text-zinc-100 text-lg w-full focus:outline-none focus:border-b border-primary/50 placeholder-zinc-600 px-1 truncate"
                    placeholder="Set Name"
                />
                 <datalist id={`band-members-${setList.id}`}>
                    {bandMembers.map((m, i) => <option key={i} value={m} />)}
                    <option value={`Set ${setIndex + 1}`} />
                </datalist>
            </div>

            {/* Trash Button - Placed directly in flex flow for reliability */}
            <button 
                type="button"
                data-no-dnd="true"
                className="p-1.5 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer flex-shrink-0"
                title="Remove Set"
                onPointerDownCapture={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // @ts-ignore
                    e.nativeEvent?.stopImmediatePropagation?.();
                }}
                onMouseDownCapture={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // @ts-ignore
                    e.nativeEvent?.stopImmediatePropagation?.();
                }}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemoveSet(setList.id);
                }}
            >
                <Icons.Trash size={18} />
            </button>

             {/* Status Selector */}
            <select 
                value={setList.status || 'Draft'}
                onChange={(e) => onUpdateSetDetails(setList.id, { status: e.target.value as SetStatus })}
                className={`text-[10px] uppercase font-bold px-1.5 py-1 rounded border outline-none appearance-none cursor-pointer flex-shrink-0 ${getStatusColor(setList.status)}`}
            >
                <option value="Draft">Draft</option>
                <option value="Proposed">Proposed</option>
                <option value="Final">Final</option>
            </select>
        </div>
        
        <div className="px-4 pb-3 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1">
            <Icons.Music size={12} />
            <span>{setList.songs.length} Songs</span>
          </div>
          <div className="flex items-center gap-1 font-mono bg-purple-600 text-white px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0">
            <Icons.Clock size={12} />
            <span>{formatDurationHuman(totalDuration)}</span>
          </div>
        </div>
      </div>

      {/* Set Content (Droppable Area) */}
      <div ref={setDroppableRef} className="flex-1 p-3 overflow-y-auto min-h-[150px] bg-[#121215]">
        <SortableContext 
          items={setList.songs.map(s => s.instanceId)} 
          strategy={verticalListSortingStrategy}
        >
          {setList.songs.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-zinc-600 border-2 border-dashed border-zinc-800 rounded-lg p-8">
                <Icons.Music className="mb-2 opacity-50" size={32} />
                <p className="text-sm font-medium">Drop songs here</p>
                <p className="text-xs text-zinc-500 text-center mt-1">Drag from the library to build your set</p>
             </div>
          ) : (
            setList.songs.map((song, index) => (
              <SortableSetSong 
                key={song.instanceId} 
                song={song} 
                setId={setList.id}
                index={index}
                isDuplicate={duplicateSongIds.includes(song.songId)}
                onRemove={() => onRemoveSong(setList.id, song.instanceId)}
                onUpdateNote={(note) => onUpdateNote(setList.id, song.instanceId, note)}
                onPlay={() => onPlaySong(song)}
                onEdit={() => onEditSong({ ...song, id: song.songId, active: true })}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
};
