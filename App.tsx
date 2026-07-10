import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  DndContext, 
  DragOverlay, 
  useSensor, 
  useSensors, 
  PointerSensor, 
  DragStartEvent, 
  DragEndEvent, 
  DragOverEvent,
  defaultDropAnimationSideEffects,
  DropAnimation,
  closestCorners
} from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { v4 as uuidv4 } from 'uuid';

import { Song, SetList, SetSong, GigDetails, PDFOptions, BandSettings } from './types';
import { parseCSV, formatDuration, generatePDFDoc, generateTimeOptions, parseDurationToSeconds, parseBandProfileCSV, transformGoogleSheetUrl, parseGigDetailsCSV } from './utils';
import { SongLibrary } from './components/SongLibrary';
import { SetListColumn } from './components/SetListColumn';
import { Icons } from './components/ui/Icons';
import { loadBootstrap, saveState, getGigs, createGig, updateGig, deleteGig, checkHealth, checkEnv, getDiagnostics, ApiRequestError } from './src/services/api';
import { useDatabaseHealth } from './src/hooks/useDatabaseHealth';
import { DatabaseHealthBadge } from './src/components/DatabaseHealthBadge';

function diagnosticText(value: unknown, fallback = 'N/A'): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.5',
      },
    },
  }),
};

// Custom Sensor to ignore interactive elements
class SafePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: any) => {
        const target = nativeEvent?.target as HTMLElement | null;
        if (!target) return false;

        // Do NOT start a drag from interactive elements
        if (target.closest('button, a, input, select, textarea, [data-no-dnd]')) {
          return false;
        }
        return true;
      },
    },
  ];
}

// Check UUID
function isValidUUID(val: string): boolean {
  if (!val) return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(val);
}

// --- Edit Modal Component ---
const EditSongModal = ({ song, isOpen, onClose, onSave }: { song: Song | null, isOpen: boolean, onClose: () => void, onSave: (s: Song) => void }) => {
    const [formData, setFormData] = React.useState<Song | null>(null);
    const [durationStr, setDurationStr] = React.useState('');

    React.useEffect(() => {
        if (song) {
            setFormData({ ...song });
            setDurationStr(formatDuration(song.durationSeconds));
        }
    }, [song]);

    if (!isOpen || !formData) return null;

    const handleSave = () => {
        if (formData) {
            onSave({
                ...formData,
                durationSeconds: parseDurationToSeconds(durationStr)
            });
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-[#121215] border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-zinc-900 sticky top-0 z-10">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                        <Icons.Edit size={16} className="text-primary"/>
                        Edit Song Details
                    </h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white"><Icons.Close size={20}/></button>
                </div>
                
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Basic Info */}
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Basic Info</h4>
                        <div>
                            <label className="text-xs text-zinc-400 block mb-1">Song Title</label>
                            <input type="text" value={formData.title || ''} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none" />
                        </div>
                        <div>
                            <label className="text-xs text-zinc-400 block mb-1">Artist</label>
                            <input type="text" value={formData.artist || ''} onChange={e => setFormData({...formData, artist: e.target.value})} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none" />
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="text-xs text-zinc-400 block mb-1">Duration (m:s)</label>
                                <input type="text" value={durationStr} onChange={e => setDurationStr(e.target.value)} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none font-mono" />
                            </div>
                        </div>

                        {/* Status Toggles */}
                        <div className="bg-black/20 p-3 rounded-lg border border-white/5 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-zinc-300">Played Live</span>
                                <button 
                                    onClick={() => setFormData(prev => {
                                        if (!prev) return null;
                                        const newVal = !prev.playedLive;
                                        return {
                                            ...prev,
                                            playedLive: newVal,
                                            practiceStatus: newVal ? 'Ready' : prev.practiceStatus
                                        };
                                    })}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.playedLive ? 'bg-green-600' : 'bg-zinc-700'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.playedLive ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-sm text-zinc-300">Song Status</span>
                                <div className="flex bg-zinc-800 rounded-lg p-0.5">
                                    <button 
                                        onClick={() => setFormData({...formData, practiceStatus: 'Practice', playedLive: false})}
                                        className={`px-3 py-1 text-xs rounded-md transition-all ${formData.practiceStatus === 'Practice' ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`}
                                    >Practice</button>
                                    <button 
                                        onClick={() => setFormData({...formData, practiceStatus: 'Ready'})}
                                        className={`px-3 py-1 text-xs rounded-md transition-all ${formData.practiceStatus === 'Ready' ? 'bg-primary text-white' : 'text-zinc-500'}`}
                                    >Ready</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Meta Info */}
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Metrics</h4>
                        <div>
                            <label className="text-xs text-zinc-400 block mb-1">Rating (1-5)</label>
                            <div className="flex gap-2">
                                {[1,2,3,4,5].map(star => (
                                    <button key={star} onClick={() => setFormData({...formData, rating: star})} className={`text-xl ${star <= (formData.rating || 0) ? 'text-yellow-500' : 'text-zinc-700'}`}>★</button>
                                ))}
                            </div>
                        </div>
                        
                        <div>
                             <label className="text-xs text-zinc-400 block mb-1">General Notes</label>
                             <textarea 
                                rows={4}
                                value={formData.generalNotes || ''} 
                                onChange={e => setFormData({...formData, generalNotes: e.target.value})} 
                                className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-xs text-zinc-300 focus:border-primary outline-none resize-none"
                                placeholder="Tuning, Capo, Key, etc."
                             />
                        </div>
                    </div>

                    {/* Links */}
                    <div className="col-span-1 md:col-span-2 space-y-4 pt-4 border-t border-white/5">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">External Links</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-zinc-400 block mb-1 flex items-center gap-1"><Icons.Youtube size={12}/> Video URL</label>
                                <input type="text" value={formData.videoUrl || ''} onChange={e => setFormData({...formData, videoUrl: e.target.value})} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-xs text-zinc-300 focus:border-primary outline-none" placeholder="https://youtube.com/..." />
                            </div>
                            <div>
                                <label className="text-xs text-zinc-400 block mb-1 flex items-center gap-1"><Icons.Link size={12}/> Lyrics URL</label>
                                <input type="text" value={formData.lyricsUrl || ''} onChange={e => setFormData({...formData, lyricsUrl: e.target.value})} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-xs text-zinc-300 focus:border-primary outline-none" placeholder="https://..." />
                            </div>
                            <div>
                                <label className="text-xs text-zinc-400 block mb-1 flex items-center gap-1"><Icons.Guitar size={12}/> Guitar Lesson</label>
                                <input type="text" value={formData.guitarLessonUrl || ''} onChange={e => setFormData({...formData, guitarLessonUrl: e.target.value})} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-xs text-zinc-300 focus:border-primary outline-none" placeholder="https://youtube.com/..." />
                            </div>
                            <div>
                                <label className="text-xs text-zinc-400 block mb-1 flex items-center gap-1"><Icons.Music size={12}/> Bass Lesson</label>
                                <input type="text" value={formData.bassLessonUrl || ''} onChange={e => setFormData({...formData, bassLessonUrl: e.target.value})} className="w-full bg-black/30 border border-zinc-700 rounded p-2 text-xs text-zinc-300 focus:border-primary outline-none" placeholder="https://youtube.com/..." />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-white/5 flex justify-end gap-2 bg-zinc-900 sticky bottom-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <button onClick={handleSave} className="px-6 py-2 bg-primary text-white text-sm font-medium rounded-md hover:bg-indigo-500 transition-colors shadow-lg shadow-primary/20">Save Changes</button>
                </div>
            </div>
        </div>
    );
};

// PDF Options Modal Component
const PDFOptionsModal = ({ isOpen, onClose, onGenerate }: { isOpen: boolean, onClose: () => void, onGenerate: (opts: PDFOptions) => void }) => {
    const [options, setOptions] = useState<PDFOptions>({
        includeNotes: false,
        oneSetPerPage: false,
        largeType: false,
        includeLogo: true,
        includeGigInfo: true
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
             <div className="bg-surface border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-zinc-900 flex justify-between">
                    <h3 className="font-semibold text-white">Print Settings</h3>
                    <button onClick={onClose}><Icons.Close size={20} className="text-zinc-500"/></button>
                </div>
                <div className="p-4 space-y-3">
                    <label className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 cursor-pointer">
                        <span className="text-sm text-zinc-300">Include Notes</span>
                        <input type="checkbox" checked={options.includeNotes} onChange={e => setOptions({...options, includeNotes: e.target.checked})} className="rounded bg-zinc-700 text-primary animate-none" />
                    </label>
                    <label className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 cursor-pointer">
                        <span className="text-sm text-zinc-300">One Set Per Page</span>
                        <input type="checkbox" checked={options.oneSetPerPage} onChange={e => setOptions({...options, oneSetPerPage: e.target.checked})} className="rounded bg-zinc-700 text-primary animate-none" />
                    </label>
                    <label className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 cursor-pointer">
                        <span className="text-sm text-zinc-300">Extra Large Type</span>
                        <input type="checkbox" checked={options.largeType} onChange={e => setOptions({...options, largeType: e.target.checked})} className="rounded bg-zinc-700 text-primary animate-none" />
                    </label>
                    <label className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 cursor-pointer">
                        <span className="text-sm text-zinc-300">Include Band Logo</span>
                        <input type="checkbox" checked={options.includeLogo} onChange={e => setOptions({...options, includeLogo: e.target.checked})} className="rounded bg-zinc-700 text-primary animate-none" />
                    </label>
                    <label className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 cursor-pointer">
                        <span className="text-sm text-zinc-300">Include Venue/Time</span>
                        <input type="checkbox" checked={options.includeGigInfo} onChange={e => setOptions({...options, includeGigInfo: e.target.checked})} className="rounded bg-zinc-700 text-primary animate-none" />
                    </label>

                    <button 
                        onClick={() => onGenerate(options)}
                        className="w-full mt-4 py-2 bg-primary text-white rounded-md font-medium hover:bg-indigo-500 transition-colors flex items-center justify-center gap-2"
                    >
                        <Icons.Print size={16} /> Generate PDF
                    </button>
                </div>
             </div>
        </div>
    );
};

// Band Settings Modal
const BandSettingsModal = ({ 
    isOpen, 
    onClose, 
    settings, 
    onSave,
    databaseHealth
}: { 
    isOpen: boolean, 
    onClose: () => void, 
    settings: BandSettings, 
    onSave: (s: BandSettings) => void,
    databaseHealth?: any
}) => {
    const [data, setData] = useState<BandSettings>(settings);
    const [memberSlots, setMemberSlots] = useState<string[]>(Array(5).fill(''));
    
    const safeDatabaseHealth = databaseHealth ?? {
        health: null,
        status: 'unknown',
        checking: false,
        lastCheckedAt: null,
        refreshHealth: async () => {}
    };
    
    useEffect(() => {
        if (isOpen) {
            setData(settings);
            const currentMembers = Array.isArray(settings.members)
                ? [...settings.members]
                : [];
            while (currentMembers.length < 5) currentMembers.push('');
            setMemberSlots(currentMembers.slice(0, 5));
        }
    }, [isOpen, settings]);

    const handleUpdateMemberSlot = (index: number, value: string) => {
        const newSlots = [...memberSlots];
        newSlots[index] = value;
        setMemberSlots(newSlots);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
             <div className="bg-surface border border-white/10 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-zinc-900 flex justify-between items-center">
                    <h3 className="font-semibold text-white flex items-center gap-2"><Icons.Globe size={16}/> Global Band Settings</h3>
                    <button onClick={onClose}><Icons.Close size={20} className="text-zinc-500"/></button>
                </div>
                <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Band Preferences</h4>

                         <div>
                            <label className="block text-xs text-zinc-500 mb-1">Band Name</label>
                            <input 
                                type="text" 
                                className="w-full bg-background border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none"
                                value={data.name || ''}
                                onChange={e => setData({...data, name: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1">Band Logo URL</label>
                            <div className="flex gap-2">
                                 <input 
                                    type="text" 
                                    className="flex-1 bg-background border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none"
                                    value={data.logoUrl || ''}
                                    onChange={e => setData({...data, logoUrl: e.target.value})}
                                    placeholder="https://..."
                                />
                                {data.logoUrl && (
                                    <img src={data.logoUrl} className="w-10 h-10 object-contain bg-white rounded" alt="Logo Preview" />
                                )}
                            </div>
                        </div>
                        
                        <div>
                             <label className="block text-xs text-zinc-500 mb-2">Band Members</label>
                             <div className="grid grid-cols-2 gap-3">
                                {memberSlots.map((member, idx) => (
                                    <div key={idx} className="col-span-1">
                                        <label className="block text-[10px] text-zinc-600 mb-0.5">Member {idx + 1}</label>
                                        <input 
                                            type="text"
                                            className="w-full bg-background border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none"
                                            value={member || ''}
                                            onChange={(e) => handleUpdateMemberSlot(idx, e.target.value)}
                                            placeholder={`Member ${idx + 1}`}
                                        />
                                    </div>
                                ))}
                             </div>
                        </div>
                    </div>

                    <div className="h-px bg-white/5 my-4"></div>

                    {/* SYSTEM STATUS */}
                    <div className="space-y-3 bg-zinc-900/40 p-4 border border-white/5 rounded-lg">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">System Status</h4>
                        
                        <div className="space-y-2 text-xs">
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Database variable:</span>
                                <span className="font-semibold text-zinc-200">
                                    {safeDatabaseHealth.health?.databaseUrlPresent !== false ? 'Detected' : 'Not detected'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Neon connection:</span>
                                <span className={`font-semibold ${
                                    safeDatabaseHealth.status === 'connected' ? 'text-emerald-400' :
                                    safeDatabaseHealth.status === 'connection-failed' ? 'text-rose-400' :
                                    safeDatabaseHealth.status === 'variable-missing' ? 'text-amber-400' : 'text-zinc-400'
                                }`}>
                                    {safeDatabaseHealth.status === 'connected' && 'Connected'}
                                    {safeDatabaseHealth.status === 'connection-failed' && 'Failed'}
                                    {safeDatabaseHealth.status === 'variable-missing' && 'Not tested'}
                                    {safeDatabaseHealth.status === 'checking' && 'Checking...'}
                                    {safeDatabaseHealth.status === 'unknown' && 'Unknown'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Environment:</span>
                                <span className="font-semibold text-zinc-200">
                                    {safeDatabaseHealth.health?.environment === 'production' ? 'Production' :
                                     safeDatabaseHealth.health?.environment === 'preview' ? 'Preview' :
                                     safeDatabaseHealth.health?.environment === 'development' ? 'Development' : 
                                     safeDatabaseHealth.health?.environment || 'Unknown'}
                                </span>
                            </div>
                            {safeDatabaseHealth.health?.region && (
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Region:</span>
                                    <span className="font-semibold text-zinc-200">{safeDatabaseHealth.health.region}</span>
                                </div>
                            )}
                            {safeDatabaseHealth.lastCheckedAt && (
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Last checked:</span>
                                    <span className="text-zinc-400">{safeDatabaseHealth.lastCheckedAt.toLocaleTimeString()}</span>
                                </div>
                            )}
                        </div>

                        <div className="pt-1">
                            <button
                                type="button"
                                onClick={() => safeDatabaseHealth.refreshHealth()}
                                disabled={safeDatabaseHealth.checking}
                                className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <Icons.Refresh size={11} className={safeDatabaseHealth.checking ? 'animate-spin' : ''} />
                                {safeDatabaseHealth.checking ? 'Testing...' : 'Test Database Connection'}
                            </button>
                        </div>
                        <p className="text-[10px] text-zinc-600 leading-normal">
                            DATABASE_URL is configured in the Vercel project environment settings, not in this application form.
                        </p>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400">Cancel</button>
                        <button 
                            onClick={() => { 
                                const finalMembers = memberSlots.filter(m => m.trim() !== '');
                                onSave({ ...data, members: finalMembers }); 
                                onClose(); 
                            }}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-white hover:bg-indigo-500 transition-colors"
                        >
                            Save Settings
                        </button>
                    </div>
                </div>
             </div>
        </div>
    );
};

// Generic Confirmation Modal
interface ConfirmationState {
    type: 'REMOVE_SET' | 'REPLACE_LIBRARY' | 'CLEAR_LIBRARY';
    title: string;
    message: string;
    confirmLabel: string;
    confirmVariant?: 'danger' | 'primary';
    data?: any;
}

const ConfirmationModal = ({ isOpen, state, onClose, onConfirm }: { isOpen: boolean, state: ConfirmationState | null, onClose: () => void, onConfirm: () => void }) => {
    if (!isOpen || !state) return null;
    
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-zinc-900 flex justify-between items-center">
                    <h3 className="font-semibold text-white">{state.title}</h3>
                    <button onClick={onClose}>
                        <Icons.Close size={20} className="text-zinc-500" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-sm text-zinc-300 leading-relaxed">
                        {state.message}
                    </p>

                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                        >
                            Cancel
                        </button>

                        <button
                            onClick={onConfirm}
                            className={`px-4 py-2 rounded-md text-sm font-medium text-white transition-colors ${state.confirmVariant === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-primary hover:bg-indigo-500'}`}
                        >
                            {state.confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DEFAULT_LIBRARY_URL = 'https://docs.google.com/spreadsheets/d/1m8sg7CRO4-ZpYp4UYatVHak7lqgRpRydc9pKGz9t7DY/edit?usp=sharing';
const DEFAULT_PROFILE_URL = 'https://docs.google.com/spreadsheets/d/1m8sg7CRO4-ZpYp4UYatVHak7lqgRpRydc9pKGz9t7DY/edit?gid=1234320810';
const DEFAULT_GIG_DETAILS_URL = 'https://docs.google.com/spreadsheets/d/1m8sg7CRO4-ZpYp4UYatVHak7lqgRpRydc9pKGz9t7DY/edit?gid=1936545164';

export default function App() {
  // State
  const databaseHealth = useDatabaseHealth();
  const [bandSettings, setBandSettings] = useState<BandSettings>({
      name: 'My Band',
      logoUrl: '',
      members: ['Drummer', 'Bassist', 'Guitarist', 'Singer'],
      defaultLibraryUrl: DEFAULT_LIBRARY_URL,
      bandProfileUrl: DEFAULT_PROFILE_URL,
      gigDetailsUrl: DEFAULT_GIG_DETAILS_URL
  });
  const [songs, setSongs] = useState<Song[]>([]);
  const [sets, setSets] = useState<SetList[]>([]);
  const [gigDetails, setGigDetails] = useState<GigDetails & { id: string; status?: string }>({
    id: '',
    name: 'Untitled Gig',
    location: '',
    date: '',
    startTime: '20:00',
    arriveTime: '18:00',
    notes: '',
    status: 'Draft'
  });
  const [gigs, setGigs] = useState<any[]>([]);
  const [usage, setUsage] = useState<Record<string, any[]>>({});

  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<{
    message: string;
    detail?: string;
    requestId?: string;
    stage?: string;
    code?: string;
  } | null>(null);

  interface BootstrapFailure {
    httpStatus?: number;
    requestId?: string | null;
    stage?: string | null;
    code?: string | null;
    message?: string | null;
    detail?: string | null;
    error?: string | null;
    databaseTable?: string | null;
    databaseColumn?: string | null;
    databaseConstraint?: string | null;
    hint?: string | null;
    rawResponse?: string | null;
  }

  function formatDiagnosticValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return 'N/A';
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  const [bootstrapFailure, setBootstrapFailure] = useState<BootstrapFailure | null>(null);

  interface BootstrapTestResult {
    httpStatus?: number;
    ok?: boolean;
    body?: any;
  }

  const [bootstrapTestResult, setBootstrapTestResult] = useState<BootstrapTestResult | null>(null);
  const [testingBootstrap, setTestingBootstrap] = useState(false);
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  const [diagnosticTitle, setDiagnosticTitle] = useState<string>('');
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [interpretation, setInterpretation] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveButtonState, setSaveButtonState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [autosaveStatus, setAutosaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');
  const [autosaveError, setAutosaveError] = useState<{
    message: string;
    timestamp: Date;
    detail?: string | null;
    code?: string | null;
    stage?: string | null;
    httpStatus?: number | null;
    rawResponse?: string | null;
  } | null>(null);
  const [autosaveModalOpen, setAutosaveModalOpen] = useState(false);
  const [copiedAutosaveDiagnostics, setCopiedAutosaveDiagnostics] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);

  // New Gig creation modal state
  const [showCreateGigModal, setShowCreateGigModal] = useState(false);
  const [newGigName, setNewGigName] = useState('');
  const [creatingGigInProgress, setCreatingGigInProgress] = useState(false);

  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const [draggingSetId, setDraggingSetId] = useState<string | null>(null);
  const [setDropTargetId, setSetDropTargetId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showGigDetails, setShowGigDetails] = useState(false);
  const [showBandSettings, setShowBandSettings] = useState(false);
  const [showPDFOptions, setShowPDFOptions] = useState(false);
  const [importText, setImportText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [importSaveStatus, setImportSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'error'>('idle');
  const [importSaveError, setImportSaveError] = useState<string>('');
  
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmationState | null>(null);

  const [clientRuntimeError, setClientRuntimeError] =
    useState<{
      message: string;
      stack?: string;
      source?: string;
    } | null>(null);

  function isIgnorableDevelopmentError(
    reason: unknown
  ): boolean {
    const message =
      reason instanceof Error
        ? reason.message
        : String(reason ?? '');

    const stack =
      reason instanceof Error
        ? reason.stack || ''
        : '';

    const combined =
      `${message}\n${stack}`.toLowerCase();

    const isViteClientError =
      combined.includes('@vite/client') ||
      combined.includes('/@vite/client');

    const isWebSocketDisconnect =
      combined.includes(
        'websocket closed without opened'
      ) ||
      combined.includes(
        'websocket closed before the connection is established'
      ) ||
      combined.includes(
        'failed to construct websocket'
      );

    const isDevelopmentHost =
      window.location.hostname.includes(
        'run.app'
      ) ||
      window.location.hostname.includes(
        'localhost'
      ) ||
      window.location.hostname.includes(
        '127.0.0.1'
      );

    return (
      isDevelopmentHost &&
      isViteClientError &&
      isWebSocketDisconnect
    );
  }

  useEffect(() => {
    const handleWindowError = (
      event: ErrorEvent
    ) => {
      if (
        isIgnorableDevelopmentError(
          event.error || event.message
        )
      ) {
        console.warn(
          'Vite HMR connection disconnected; ignoring.',
          event.error || event.message
        );

        event.preventDefault();
        return;
      }

      console.error(
        'WINDOW_RUNTIME_ERROR',
        event.error || event.message
      );

      setClientRuntimeError({
        message:
          event.error?.message ||
          event.message ||
          'Unknown browser error',
        stack:
          event.error?.stack || undefined,
        source:
          event.filename
            ? `${event.filename}:${event.lineno}:${event.colno}`
            : undefined
      });
    };

    const handleUnhandledRejection = (
      event: PromiseRejectionEvent
    ) => {
      const reason = event.reason;

      if (
        isIgnorableDevelopmentError(reason)
      ) {
        console.warn(
          'Vite HMR connection disconnected; ignoring.',
          reason
        );

        event.preventDefault();
        return;
      }

      console.error(
        'UNHANDLED_PROMISE_REJECTION',
        reason
      );

      setClientRuntimeError({
        message:
          reason instanceof Error
            ? reason.message
            : String(
                reason ||
                'Unhandled promise rejection'
              ),
        stack:
          reason instanceof Error
            ? reason.stack
            : undefined,
        source:
          'Unhandled Promise Rejection'
      });
    };

    window.addEventListener(
      'error',
      handleWindowError
    );

    window.addEventListener(
      'unhandledrejection',
      handleUnhandledRejection
    );

    return () => {
      window.removeEventListener(
        'error',
        handleWindowError
      );

      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection
      );
    };
  }, []);

  // Mark state dirty
  const markDirty = () => {
    setIsDirty(true);
    setAutosaveStatus('unsaved');
  };

  // Bootstrap from database
  const loadData = async (targetGigId?: string) => {
    setLoading(true);
    setErrorState(null);
    try {
      let gigIdToLoad = targetGigId;
      if (!gigIdToLoad) {
        gigIdToLoad = localStorage.getItem('active-gig-id') || undefined;
      }

      const data = await loadBootstrap(gigIdToLoad);
      if (data.setupRequired) {
        setSetupRequired(true);
        setLoading(false);
        return;
      }

      setSetupRequired(false);
      if (data.band) {
        setBandSettings({
          name:
            data.band.name || 'My Band',
          logoUrl:
            data.band.logoUrl || '',
          members:
            Array.isArray(data.band.members)
              ? data.band.members
              : [],
          defaultLibraryUrl:
            data.band.defaultLibraryUrl || '',
          bandProfileUrl:
            data.band.bandProfileUrl || '',
          gigDetailsUrl:
            data.band.gigDetailsUrl || ''
        });
      }
      if (data.songs) setSongs(data.songs);
      if (data.gigs) setGigs(data.gigs);
      if (data.usage) setUsage(data.usage);

      if (data.activeGig) {
        setGigDetails({
          id: data.activeGig.id,
          name: data.activeGig.name,
          location: data.activeGig.location,
          date: data.activeGig.gigDate,
          startTime: data.activeGig.startTime,
          arriveTime: data.activeGig.arriveTime,
          notes: data.activeGig.notes,
          status: data.activeGig.status || 'Draft'
        });
        localStorage.setItem('active-gig-id', data.activeGig.id);
      } else {
        setGigDetails({
          id: '',
          name: 'Untitled Gig',
          location: '',
          date: '',
          startTime: '20:00',
          arriveTime: '18:00',
          notes: '',
          status: 'Draft'
        });
        localStorage.removeItem('active-gig-id');
      }

      if (data.sets) {
        setSets(data.sets);
      } else {
        setSets([]);
      }

      setBootstrapFailure(null);
      setIsDirty(false);
      setAutosaveStatus('saved');
      setIsInitialized(true);
    } catch (err: any) {
      console.error('Failed to load setlist data:', err);

      const payload =
        err instanceof ApiRequestError
          ? err.payload
          : err?.payload || err?.data || null;

      const databaseError = payload?.databaseError;

      const message = diagnosticText(
        databaseError?.message ??
        payload?.normalizedMessage ??
        payload?.message ??
        payload?.error ??
        err?.message,
        'Unable to load setlist data from Neon'
      );

      const detail = diagnosticText(
        databaseError?.detail ??
        payload?.detail ??
        payload?.rawResponse,
        'No additional database detail returned'
      );

      setErrorState({
        message,
        detail,
        requestId: diagnosticText(payload?.requestId, 'N/A'),
        stage: diagnosticText(payload?.stage, 'N/A'),
        code: diagnosticText(
          databaseError?.code ?? payload?.code,
          'N/A'
        )
      });

      setBootstrapFailure({
        httpStatus:
          err instanceof ApiRequestError
            ? err.status
            : payload?.httpStatus || 500,

        requestId: diagnosticText(payload?.requestId, 'N/A'),
        stage: diagnosticText(payload?.stage, 'N/A'),

        code: diagnosticText(
          databaseError?.code ?? payload?.code,
          'N/A'
        ),

        message,

        detail,

        error: diagnosticText(payload?.error, 'N/A'),

        databaseTable: diagnosticText(
          databaseError?.table ?? payload?.databaseTable,
          'N/A'
        ),

        databaseColumn: diagnosticText(
          databaseError?.column ?? payload?.databaseColumn,
          'N/A'
        ),

        databaseConstraint: diagnosticText(
          databaseError?.constraint ??
          payload?.databaseConstraint,
          'N/A'
        ),

        rawResponse: diagnosticText(
          payload?.rawResponse,
          'No raw response captured'
        )
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Save changes to database (PUT /api/save-state)
  const saveChanges = async (forcePayload?: any) => {
    if (!isInitialized || setupRequired) return false;

    const payload = forcePayload || {
      bandSettings,
      songs,
      gig: {
        id: gigDetails.id,
        name: gigDetails.name,
        location: gigDetails.location,
        gigDate: gigDetails.date,
        startTime: gigDetails.startTime,
        arriveTime: gigDetails.arriveTime,
        notes: gigDetails.notes,
        status: gigDetails.status
      },
      sets
    };

    setSaveButtonState('saving');
    setAutosaveStatus('saving');

    try {
      const response = await saveState(payload);
      if (response.ok) {
        if (response.band) {
          setBandSettings({
            name:
              response.band.name || 'My Band',
            logoUrl:
              response.band.logoUrl || '',
            members:
              Array.isArray(response.band.members)
                ? response.band.members
                : [],
            defaultLibraryUrl:
              response.band.defaultLibraryUrl || '',
            bandProfileUrl:
              response.band.bandProfileUrl || '',
            gigDetailsUrl:
              response.band.gigDetailsUrl || ''
          });
        }
        if (response.songs) setSongs(response.songs);
        if (response.gig) {
          setGigDetails({
            id: response.gig.id,
            name: response.gig.name,
            location: response.gig.location,
            date: response.gig.gigDate,
            startTime: response.gig.startTime,
            arriveTime: response.gig.arriveTime,
            notes: response.gig.notes,
            status: response.gig.status
          });
          localStorage.setItem('active-gig-id', response.gig.id);
        }
        if (response.sets) setSets(response.sets);
        if (response.usage) setUsage(response.usage);

        const updatedGigs = await getGigs();
        setGigs(updatedGigs);

        setIsDirty(false);
        setAutosaveStatus('saved');
        setAutosaveError(null);
        setSaveButtonState('saved');
        setTimeout(() => setSaveButtonState('idle'), 2000);
        return true;
      }
      throw new Error(response.detail || 'Save failed');
    } catch (err: any) {
      console.error('Failed to save state:', err);
      setSaveButtonState('failed');
      setAutosaveStatus('failed');
      setAutosaveError({
        message: err.message || 'Unknown save error',
        timestamp: new Date(),
        detail: err.detail || null,
        code: err.code || null,
        stage: err.stage || null,
        httpStatus: err.httpStatus || null,
        rawResponse: err.rawResponse || null
      });
      setTimeout(() => setSaveButtonState('idle'), 4000);
      return false;
    }
  };

  // Debounced Autosave effect
  const saveStateRef = useRef({ bandSettings, songs, gigDetails, sets, isInitialized, setupRequired });
  useEffect(() => {
    saveStateRef.current = { bandSettings, songs, gigDetails, sets, isInitialized, setupRequired };
  }, [bandSettings, songs, gigDetails, sets, isInitialized, setupRequired]);

  const saveInProgressRef = useRef(false);
  const savePendingRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || setupRequired || !isDirty || !gigDetails.id) {
      return;
    }

    const triggerSave = async () => {
      if (saveInProgressRef.current) {
        savePendingRef.current = true;
        return;
      }

      saveInProgressRef.current = true;
      setAutosaveStatus('saving');

      const currentPayload = {
        bandSettings: saveStateRef.current.bandSettings,
        songs: saveStateRef.current.songs,
        gig: {
          id: saveStateRef.current.gigDetails.id,
          name: saveStateRef.current.gigDetails.name,
          location: saveStateRef.current.gigDetails.location,
          gigDate: saveStateRef.current.gigDetails.date,
          startTime: saveStateRef.current.gigDetails.startTime,
          arriveTime: saveStateRef.current.gigDetails.arriveTime,
          notes: saveStateRef.current.gigDetails.notes,
          status: saveStateRef.current.gigDetails.status
        },
        sets: saveStateRef.current.sets
      };

      const success = await saveChanges(currentPayload);
      saveInProgressRef.current = false;

      if (savePendingRef.current) {
        savePendingRef.current = false;
        setTimeout(triggerSave, 500);
      }
    };

    const timer = setTimeout(() => {
      triggerSave();
    }, 1200);

    return () => clearTimeout(timer);
  }, [isDirty, sets, songs, gigDetails, bandSettings, isInitialized, setupRequired]);



  // Duplicate song ids computation
  const duplicateSongIds = useMemo(() => {
    const counts: Record<string, number> = {};
    sets.forEach((set) => {
        set.songs.forEach(song => {
            counts[song.songId] = (counts[song.songId] || 0) + 1;
        });
    });
    const dupes: string[] = [];
    Object.keys(counts).forEach(id => {
        if (counts[id] > 1) dupes.push(id);
    });
    return dupes;
  }, [sets]);

  const sensors = useSensors(
    useSensor(SafePointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const timeOptions = useMemo(() => generateTimeOptions(), []);

  const handleGeneratePDF = (options: PDFOptions) => {
      generatePDFDoc(sets, gigDetails, options, bandSettings);
      setShowPDFOptions(false);
  };

  const playSong = (song: Song | SetSong) => {
    const songObj = 'songId' in song ? songs.find(s => s.id === song.songId) : song;
    if (songObj && songObj.videoUrl) {
        window.open(songObj.videoUrl, '_blank');
    } else {
        alert("No video URL configured for this song.");
    }
  };

  const handleUpdateSong = (updatedSong: Song) => {
    setSongs(prev => prev.map(s => s.id === updatedSong.id ? updatedSong : s));
    // Also update instances in sets
    setSets(prevSets => prevSets.map(set => ({
        ...set,
        songs: set.songs.map(s => s.songId === updatedSong.id ? {
            ...s,
            title: updatedSong.title,
            artist: updatedSong.artist,
            durationSeconds: updatedSong.durationSeconds,
            videoUrl: updatedSong.videoUrl,
            tags: updatedSong.tags,
            rating: updatedSong.rating,
            playedLive: updatedSong.playedLive,
            guitarLessonUrl: updatedSong.guitarLessonUrl,
            bassLessonUrl: updatedSong.bassLessonUrl,
            lyricsUrl: updatedSong.lyricsUrl,
            generalNotes: updatedSong.generalNotes,
            practiceStatus: updatedSong.practiceStatus
        } : s)
    })));
    markDirty();
  };

  const addSet = () => {
    const newId = `temp-set-${uuidv4()}`;
    const nextNum = sets.length + 1;
    const newSet: SetList = {
        id: newId,
        name: `Set ${nextNum}`,
        setNumber: nextNum,
        songs: [],
        color: '',
        status: 'Draft'
    };
    setSets([...sets, newSet]);
    markDirty();
  };

  const requestRemoveSet = (id: string) => {
    const setToRemove = sets.find(s => s.id === id);
    if (!setToRemove) return;
    const count = setToRemove.songs.length;
    
    setConfirmState({
        type: 'REMOVE_SET',
        title: `Remove Set?`,
        message: `Are you sure you want to remove "${setToRemove.name}"? This will also remove ${count} song${count === 1 ? '' : 's'} in this set from this gig.`,
        confirmLabel: 'Remove Set',
        confirmVariant: 'danger',
        data: { id }
    });
  };

  const removeSongFromSet = (setId: string, songInstanceId: string) => {
    setSets(sets.map(set => {
        if (set.id !== setId) return set;
        return {
            ...set,
            songs: set.songs.filter(s => s.instanceId !== songInstanceId)
        };
    }));
    markDirty();
  };

  const updateSongNote = (setId: string, songInstanceId: string, note: string) => {
    setSets(sets.map(set => {
        if (set.id !== setId) return set;
        return {
            ...set,
            songs: set.songs.map(s => s.instanceId === songInstanceId ? { ...s, notes: note } : s)
        };
    }));
    markDirty();
  };

  const updateSetDetails = (setId: string, updates: Partial<SetList>) => {
       setSets(sets.map(s => s.id === setId ? { ...s, ...updates } : s));
       // If color/status/targetDuration changes, mark dirty
       if (updates.color !== undefined || updates.status !== undefined || updates.targetDurationSeconds !== undefined || updates.name !== undefined) {
         markDirty();
       }
  };

  const handleFetchFromUrl = async () => {
        if (!bandSettings.defaultLibraryUrl) return;
        const url = transformGoogleSheetUrl(bandSettings.defaultLibraryUrl);

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Network response was not ok');
            const text = await res.text();
            setImportText(text);
        } catch (error) {
            console.error("Failed to fetch library", error);
            alert("Failed to load library from URL. Ensure the Google Sheet is Public.");
        }
  };

  const loadLibraryIntoImport = async (
    sourceUrl: string
  ) => {
    const url = transformGoogleSheetUrl(sourceUrl);

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `Spreadsheet request failed with HTTP ${res.status}.`
      );
    }

    const text = await res.text();

    const trimmed = text.trim().toLowerCase();

    if (
      trimmed.startsWith('<!doctype html') ||
      trimmed.startsWith('<html')
    ) {
      throw new Error(
        'Google returned an HTML page. Confirm the sheet is shared as Anyone with the link → Viewer.'
      );
    }

    const firstLine =
      text.split(/\r?\n/)[0] || '';

    const normalizedHeaders =
      firstLine.toLowerCase();

    const hasTitle =
      normalizedHeaders.includes('title');

    const hasArtist =
      normalizedHeaders.includes('artist');

    if (!hasTitle || !hasArtist) {
      throw new Error(
        `Song Library headers were not found. Received first row: ${firstLine}`
      );
    }

    setImportText(text);
    setShowBandSettings(false);
    setShowImport(true);
  };



const handleImportSongsMatch = async (
  incoming: Song[],
  mode: 'add' | 'replace'
): Promise<boolean> => {
  setImportSaveStatus('saving');
  setImportSaveError('');
  try {
    console.log(
      'IMPORT_MATCH_STARTED',
      {
        mode,
        incomingCount:
          Array.isArray(incoming)
            ? incoming.length
            : null,
        currentSongCount:
          Array.isArray(songs)
            ? songs.length
            : null,
        firstIncomingSong:
          Array.isArray(incoming) &&
          incoming.length > 0
            ? incoming[0]
            : null
      }
    );

    const normalize = (
      value: unknown
    ): string =>
      String(value ?? '')
        .trim()
        .toLowerCase();

    const updatedSongs: Song[] =
      Array.isArray(songs)
        ? songs.map(song => ({
            ...song,
            tags: Array.isArray(song.tags)
              ? song.tags
              : []
          }))
        : [];

    const safeIncoming =
      Array.isArray(incoming)
        ? incoming
        : [];

    safeIncoming.forEach(rawSong => {
      const incomingSong: Song = {
        ...rawSong,

        id:
          rawSong.id ||
          `temp-song-${uuidv4()}`,

        title:
          rawSong.title?.trim() ||
          'Untitled Song',

        artist:
          rawSong.artist?.trim() ||
          'Unknown Artist',

        durationSeconds:
          Number.isFinite(
            Number(rawSong.durationSeconds)
          )
            ? Math.max(
                0,
                Number(
                  rawSong.durationSeconds
                )
              )
            : 0,

        tags: Array.isArray(
          rawSong.tags
        )
          ? rawSong.tags
          : [],

        rating:
          rawSong.rating === null ||
          rawSong.rating === undefined
            ? null
            : Number(rawSong.rating),

        playedLive:
          Boolean(rawSong.playedLive),

        practiceStatus:
          rawSong.practiceStatus ===
          'Practice'
            ? 'Practice'
            : 'Ready',

        active:
          rawSong.active !== false
      };

      let matchIndex = -1;

      if (
        isValidUUID(incomingSong.id)
      ) {
        matchIndex =
          updatedSongs.findIndex(
            existing =>
              existing.id ===
              incomingSong.id
          );
      }

      if (
        matchIndex === -1 &&
        incomingSong.externalId
      ) {
        matchIndex =
          updatedSongs.findIndex(
            existing =>
              existing.externalId ===
              incomingSong.externalId
          );
      }

      if (matchIndex === -1) {
        matchIndex =
          updatedSongs.findIndex(
            existing =>
              normalize(existing.title) ===
                normalize(
                  incomingSong.title
                ) &&
              normalize(existing.artist) ===
                normalize(
                  incomingSong.artist
                )
          );
      }

      if (matchIndex >= 0) {
        const existing =
          updatedSongs[matchIndex];

        updatedSongs[matchIndex] = {
          ...existing,

          title:
            incomingSong.title,

          artist:
            incomingSong.artist,

          durationSeconds:
            incomingSong.durationSeconds,

          videoUrl:
            incomingSong.videoUrl ||
            existing.videoUrl ||
            null,

          tags:
            incomingSong.tags.length > 0
              ? incomingSong.tags
              : (
                  Array.isArray(
                    existing.tags
                  )
                    ? existing.tags
                    : []
                ),

          rating:
            incomingSong.rating !== null &&
            incomingSong.rating !== undefined
              ? incomingSong.rating
              : existing.rating ?? null,

          playedLive:
            incomingSong.playedLive,

          guitarLessonUrl:
            incomingSong.guitarLessonUrl ||
            existing.guitarLessonUrl ||
            null,

          bassLessonUrl:
            incomingSong.bassLessonUrl ||
            existing.bassLessonUrl ||
            null,

          lyricsUrl:
            incomingSong.lyricsUrl ||
            existing.lyricsUrl ||
            null,

          generalNotes:
            incomingSong.generalNotes ||
            existing.generalNotes ||
            null,

          practiceStatus:
            incomingSong.practiceStatus ||
            existing.practiceStatus ||
            'Ready',

          externalId:
            incomingSong.externalId ||
            existing.externalId ||
            null,

          active: true
        };
      } else {
        const finalId =
          isValidUUID(incomingSong.id)
            ? incomingSong.id
            : `temp-song-${uuidv4()}`;

        updatedSongs.push({
          ...incomingSong,
          id: finalId,
          tags: Array.isArray(
            incomingSong.tags
          )
            ? incomingSong.tags
            : [],
          active: true
        });
      }
    });

    console.log(
      'IMPORT_MATCH_RESULT',
      {
        updatedSongCount:
          updatedSongs.length,
        invalidSongs:
          updatedSongs.filter(
            song =>
              !song ||
              typeof song.title !==
                'string' ||
              typeof song.artist !==
                'string' ||
              !Array.isArray(song.tags) ||
              !Number.isFinite(
                Number(
                  song.durationSeconds
                )
              )
          )
      }
    );

    const invalidSongs =
      updatedSongs.filter(
        song =>
          !song ||
          typeof song.title !== 'string' ||
          typeof song.artist !== 'string' ||
          !Array.isArray(song.tags) ||
          !Number.isFinite(
            Number(song.durationSeconds)
          )
      );

    if (invalidSongs.length > 0) {
      throw new Error(
        `Import produced ${invalidSongs.length} invalid song record(s).`
      );
    }

    setSongs(updatedSongs);
    markDirty();

    const savePayload = {
      bandSettings,
      songs: updatedSongs,
      gig: {
        id: gigDetails.id,
        name: gigDetails.name,
        location: gigDetails.location,
        gigDate: gigDetails.date,
        startTime: gigDetails.startTime,
        arriveTime: gigDetails.arriveTime,
        notes: gigDetails.notes,
        status: gigDetails.status
      },
      sets
    };

    setSaveButtonState('saving');
    setAutosaveStatus('saving');

    const response = await saveState(savePayload);

    if (response.ok) {
      if (response.band) {
        setBandSettings({
          name: response.band.name || 'My Band',
          logoUrl: response.band.logoUrl || '',
          members: Array.isArray(response.band.members) ? response.band.members : [],
          defaultLibraryUrl: response.band.defaultLibraryUrl || '',
          bandProfileUrl: response.band.bandProfileUrl || '',
          gigDetailsUrl: response.band.gigDetailsUrl || ''
        });
      }
      if (response.songs) setSongs(response.songs);
      if (response.gig) {
        setGigDetails({
          id: response.gig.id,
          name: response.gig.name,
          location: response.gig.location,
          date: response.gig.gigDate,
          startTime: response.gig.startTime,
          arriveTime: response.gig.arriveTime,
          notes: response.gig.notes,
          status: response.gig.status
        });
        localStorage.setItem('active-gig-id', response.gig.id);
      }
      if (response.sets) setSets(response.sets);
      if (response.usage) setUsage(response.usage);

      const updatedGigs = await getGigs();
      setGigs(updatedGigs);

      setIsDirty(false);
      setAutosaveStatus('saved');
      setSaveButtonState('saved');
      setTimeout(() => setSaveButtonState('idle'), 2000);

      setImportSaveStatus('saved');
      setTimeout(() => {
        setShowImport(false);
        setImportText('');
        setImportSaveStatus('idle');
      }, 2000);

      return true;
    } else {
      throw new Error(response.detail || 'Save failed');
    }
  } catch (error: any) {
    const message =
      error instanceof ApiRequestError
        ? String(
            error.payload?.message ||
            error.payload?.detail ||
            error.message
          )
        : error instanceof Error
          ? error.message
          : String(error);

    setImportSaveError(message);
    setImportSaveStatus('error');

    console.error(
      'IMPORT_SAVE_FAILED',
      {
        message,
        error
      }
    );

    return false;
  }
};







  const handleImport = async (mode: 'add' | 'replace') => {
    const newSongs = parseCSV(importText);
    
    if (newSongs.length === 0) {
        alert("No valid songs found in the pasted text. Please check the format.");
        return;
    }

    if (mode === 'replace') {
         setConfirmState({
            type: 'REPLACE_LIBRARY',
            title: 'Replace Library?',
            message: `This will update matched existing songs and add new ones from your import. This cannot be undone.`,
            confirmLabel: 'Update All',
            confirmVariant: 'danger',
            data: { newSongs }
         });
    } else {
        await handleImportSongsMatch(newSongs, 'add');
    }
  };

  const requestClearLibrary = () => {
    setConfirmState({
        type: 'CLEAR_LIBRARY',
        title: 'Clear Song Library?',
        message: 'Are you sure you want to delete ALL songs from your master library? This will NOT delete placements in sets until those are saved.',
        confirmLabel: 'Clear All',
        confirmVariant: 'danger'
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmState) {
      return;
    }

    const currentConfirmation =
      confirmState;

    try {
      console.log(
        'CONFIRM_ACTION_STARTED',
        {
          type:
            currentConfirmation.type,
          importedSongCount:
            Array.isArray(
              currentConfirmation.data
                ?.newSongs
            )
              ? currentConfirmation.data
                  .newSongs.length
              : null
        }
      );

      if (
        currentConfirmation.type ===
        'REMOVE_SET'
      ) {
        const id =
          currentConfirmation.data?.id;

        setSets(currentSets => {
          const remaining = currentSets.filter(
            set => set.id !== id
          );
          return remaining.map((set, idx) => ({
            ...set,
            setNumber: idx + 1
          }));
        });

        markDirty();
      } else if (
        currentConfirmation.type ===
        'REPLACE_LIBRARY'
      ) {
        const newSongs =
          currentConfirmation.data
            ?.newSongs;

        if (!Array.isArray(newSongs)) {
          throw new Error(
            'Imported song data is missing.'
          );
        }

        const succeeded =
          await handleImportSongsMatch(
            newSongs,
            'replace'
          );

        if (!succeeded) {
          setConfirmState(null);
          return;
        }
      } else if (
        currentConfirmation.type ===
        'CLEAR_LIBRARY'
      ) {
        setSongs([]);
        markDirty();
      }

      console.log(
        'CONFIRM_ACTION_COMPLETED',
        {
          type:
            currentConfirmation.type
        }
      );

      setConfirmState(null);
    } catch (error) {
      console.error(
        'CONFIRM_ACTION_FAILED',
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      setClientRuntimeError({
        message:
          `Confirmation action failed: ${message}`,
        stack:
          error instanceof Error
            ? error.stack
            : undefined,
        source:
          'handleConfirmAction'
      });

      setConfirmState(null);
    }
  };
  
  const handleRefreshGigDetails = async () => {
    if (!bandSettings.gigDetailsUrl) {
        alert("No Gig Details URL configured in Band Settings.");
        return;
    }
    
    const url = transformGoogleSheetUrl(bandSettings.gigDetailsUrl);
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Network response was not ok");
        const text = await res.text();
        
        if (text.trim().startsWith("<!DOCTYPE html") || text.trim().startsWith("<html")) {
             throw new Error("Google returned HTML. Make sure the sheet is Public.");
        }

        const details = parseGigDetailsCSV(text);
        if (Object.keys(details).length > 0) {
            setGigDetails(prev => ({...prev, ...details}));
            markDirty();
            alert("Gig details updated from spreadsheet!");
        } else {
            alert("No valid gig details found in the spreadsheet.");
        }
    } catch (e) {
        console.error("Failed to refresh gig details", e);
        alert("Failed to load gig details: " + (e as any).message);
    }
  };

  const handleAddSongToSet = (songId: string, setId: string) => {
    const song = songs.find(item => item.id === songId);
    if (!song) {
      return;
    }

    if (setId === 'NEW_SET') {
      const newSetId = `temp-set-${uuidv4()}`;
      const newSongInstance: SetSong = {
        ...song,
        songId: song.id,
        instanceId: `placement-${uuidv4()}`,
        setId: newSetId,
        position: 1,
        notes: ''
      };
      const newSet: SetList = {
        id: newSetId,
        name: `Set ${sets.length + 1}`,
        setNumber: sets.length + 1,
        songs: [newSongInstance],
        color: '',
        status: 'Draft'
      };
      setSets([...sets, newSet]);
    } else {
      setSets(currentSets =>
        currentSets.map(set => {
          if (set.id !== setId) {
            return set;
          }

          const alreadyExists = set.songs.some(
            item => item.songId === songId
          );

          if (alreadyExists) {
            return set;
          }

          return {
            ...set,
            songs: [
              ...set.songs,
              {
                ...song,
                songId: song.id,
                instanceId: `placement-${uuidv4()}`,
                setId,
                position: set.songs.length + 1,
                notes: ''
              }
            ]
          };
        })
      );
    }

    markDirty();
  };

  const handleReorderSets = (draggedSetId: string, targetSetId: string) => {
    setSets(currentSets => {
      const oldIndex = currentSets.findIndex(s => s.id === draggedSetId);
      const newIndex = currentSets.findIndex(s => s.id === targetSetId);
      if (oldIndex === -1 || newIndex === -1) { return currentSets; }
      const items = arrayMove(currentSets, oldIndex, newIndex);
      return items.map((item, index) => ({
        ...item,
        setNumber: index + 1
      }));
    });
    markDirty();
  };

  const handleRenameSet = (setId: string, nextName: string) => {
    setSets(currentSets =>
      currentSets.map(set => {
        if (set.id !== setId) { return set; }
        return {
          ...set,
          name: nextName
        };
      })
    );
    markDirty();
  };

  // --- DND HANDLERS ---
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const type = active.data.current?.type;
    const data = active.data.current?.data;
    
    setActiveDragItem({ id: active.id, type, data });
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    if (activeType === 'SET_SONG' && overType === 'SET_SONG') {
        const activeInstanceId = active.id;
        const overInstanceId = over.id;

        const activeSetIndex = sets.findIndex(set => set.songs.some(s => s.instanceId === activeInstanceId));
        const overSetIndex = sets.findIndex(set => set.songs.some(s => s.instanceId === overInstanceId));

        if (activeSetIndex !== overSetIndex && activeSetIndex !== -1 && overSetIndex !== -1) {
            setSets(prevSets => {
                const activeSet = prevSets[activeSetIndex];
                const overSet = prevSets[overSetIndex];
                const activeSongIndex = activeSet.songs.findIndex(s => s.instanceId === activeInstanceId);
                const activeSong = activeSet.songs[activeSongIndex];

                const newActiveSetSongs = [...activeSet.songs];
                newActiveSetSongs.splice(activeSongIndex, 1);

                const newOverSetSongs = [...overSet.songs];
                const idx = newOverSetSongs.findIndex(s => s.instanceId === overInstanceId);
                newOverSetSongs.splice(idx, 0, activeSong);

                const newSets = [...prevSets];
                newSets[activeSetIndex] = { ...activeSet, songs: newActiveSetSongs };
                newSets[overSetIndex] = { ...overSet, songs: newOverSetSongs };
                
                markDirty();
                return newSets;
            });
        }
    }
  };






  const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragItem(null);

      if (!over) return;

      // SET REORDER
      if (active.data.current?.type === 'SET_COLUMN' && over.data.current?.type === 'SET_COLUMN') {
          if (active.id !== over.id) {
              const items = sets;
              const oldIndex = items.findIndex((i) => i.id === active.id);
              const newIndex = items.findIndex((i) => i.id === over.id);
              
              setSets(arrayMove(items, oldIndex, newIndex));
              markDirty();
          }
          return;
      }

      // SONG WITHIN SAME SET
      if (active.data.current?.type === 'SET_SONG' && over.data.current?.type === 'SET_SONG') {
           const activeSetId = active.data.current.originSetId;
           const overSetId = over.data.current.originSetId;

           const setIndex = sets.findIndex(s => s.songs.some(song => song.instanceId === active.id));
           if (setIndex !== -1 && activeSetId === overSetId) {
               const set = sets[setIndex];
               const oldIndex = set.songs.findIndex(s => s.instanceId === active.id);
               const newIndex = set.songs.findIndex(s => s.instanceId === over.id);

               if (oldIndex !== newIndex) {
                   const newSongs = arrayMove(set.songs, oldIndex, newIndex);
                   const newSets = [...sets];
                   newSets[setIndex] = { ...set, songs: newSongs };
                   setSets(newSets);
                   markDirty();
               }
           }
           return;
      }

      // DRAG SONG FROM LIBRARY TO SET
      if (active.data.current?.type === 'LIBRARY_SONG') {
          const songData = active.data.current.data as Song;
          const targetSetId = over.id;

          const targetSetIndex = sets.findIndex(s => s.id === targetSetId);

          if (targetSetIndex !== -1) {
              // Add to end of set
              const targetSet = sets[targetSetIndex];
              const newSong: SetSong = {
                  instanceId: `temp-placement-${uuidv4()}`,
                  songId: songData.id,
                  position: targetSet.songs.length,
                  notes: '',
                  title: songData.title,
                  artist: songData.artist,
                  durationSeconds: songData.durationSeconds,
                  videoUrl: songData.videoUrl,
                  tags: songData.tags,
                  rating: songData.rating,
                  playedLive: songData.playedLive,
                  guitarLessonUrl: songData.guitarLessonUrl,
                  bassLessonUrl: songData.bassLessonUrl,
                  lyricsUrl: songData.lyricsUrl,
                  generalNotes: songData.generalNotes,
                  practiceStatus: songData.practiceStatus
              };

              setSets(sets.map(s => {
                  if (s.id !== targetSetId) return s;
                  return { ...s, songs: [...s.songs, newSong] };
              }));
              markDirty();
          } else {
              // Dragged over another song inside a set
              const overSongId = over.id;
              const set = sets.find(s => s.songs.some(so => so.instanceId === overSongId));
              if (set) {
                  const idx = set.songs.findIndex(s => s.instanceId === overSongId);
                  const newSong: SetSong = {
                      instanceId: `temp-placement-${uuidv4()}`,
                      songId: songData.id,
                      position: idx,
                      notes: '',
                      title: songData.title,
                      artist: songData.artist,
                      durationSeconds: songData.durationSeconds,
                      videoUrl: songData.videoUrl,
                      tags: songData.tags,
                      rating: songData.rating,
                      playedLive: songData.playedLive,
                      guitarLessonUrl: songData.guitarLessonUrl,
                      bassLessonUrl: songData.bassLessonUrl,
                      lyricsUrl: songData.lyricsUrl,
                      generalNotes: songData.generalNotes,
                      practiceStatus: songData.practiceStatus
                  };

                  setSets(sets.map(s => {
                      if (s.id !== set.id) return s;
                      const newSongs = [...s.songs];
                      newSongs.splice(idx, 0, newSong);
                      return { ...s, songs: newSongs };
                  }));
                  markDirty();
              }
          }
      }
  };

  const handleCreateNewGigSubmit = async () => {
    if (!newGigName || !newGigName.trim()) {
      alert("Please enter a valid gig name");
      return;
    }
    setCreatingGigInProgress(true);
    try {
      const response = await createGig({ name: newGigName.trim() });
      if (response && response.gig) {
        // Successfully created! Switch to it
        localStorage.setItem('active-gig-id', response.gig.id);
        setShowCreateGigModal(false);
        setNewGigName('');
        await loadData(response.gig.id);
      }
    } catch (err: any) {
      console.error('Failed to create gig:', err);
      alert('Failed to create new gig: ' + err.message);
    } finally {
      setCreatingGigInProgress(false);
    }
  };

  const activeGigId = gigDetails.id;

  // Render centered loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-zinc-400 font-medium">Loading SetList Flow...</p>
      </div>
    );
  }

  // Render setup required empty state
  if (setupRequired) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-4 border border-zinc-800">
          <Icons.Globe size={28} className="text-zinc-600" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Setup Required</h2>
        <p className="text-zinc-400 text-center max-w-md mb-6 text-sm">
          No active band settings found in the database. Please initialize a band profile in Neon to begin managing setlists.
        </p>
        <button
          onClick={() => loadData()}
          className="px-6 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Render Bootstrap Failure Error Panel
  if (errorState) {
    const safeStringify = (val: any): string => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val;
      try {
        return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
      } catch {
        return String(val);
      }
    };

    const handleCheckEnv = async () => {
      setDiagnosticTitle('Environment & Health Check');
      setDiagnosticOpen(true);
      try {
        const res = await checkHealth();
        setDiagnosticResult(res);
        if (res?.ok && res.databaseUrlPresent) {
          setInterpretation('DATABASE_URL is detected and the Neon connection works.');
        } else if (res?.databaseUrlPresent === false) {
          setInterpretation('DATABASE_URL is not available to this Vercel deployment. Confirm the variable is enabled for this deployment’s environment and redeploy.');
        } else {
          setInterpretation('DATABASE_URL is present, but Neon connection failed.');
        }
      } catch (e: any) {
        const errorData = e.payload || e.data || { error: e.message };
        setDiagnosticResult(errorData);
        setInterpretation('Failed to run health check. ' + e.message);
      }
    };

    const handleCheckHealth = async () => {
      setDiagnosticTitle('Database Health Check');
      setDiagnosticOpen(true);
      try {
        const res = await checkHealth();
        setDiagnosticResult(res);
        if (res.ok) {
          setInterpretation('The Neon connection works successfully.');
        } else {
          setInterpretation('Vercel can see DATABASE_URL, but Neon rejected or could not complete the connection.');
        }
      } catch (e: any) {
        const errorData = e.payload || e.data || { error: e.message };
        setDiagnosticResult(errorData);
        setInterpretation('Vercel can see DATABASE_URL, but Neon rejected or could not complete the connection.');
      }
    };

    const handleGetDiagnostics = async () => {
      setDiagnosticTitle('Diagnostics Check');
      setDiagnosticOpen(true);
      try {
        const res = await getDiagnostics();
        setDiagnosticResult(res);
        if (res.ok) {
          setInterpretation('All checks passed! The Neon connection works and the tables exist.');
        } else {
          setInterpretation('Vercel can see DATABASE_URL, but Neon rejected or could not complete the connection.');
        }
      } catch (e: any) {
        const errorData = e.payload || e.data || { error: e.message };
        setDiagnosticResult(errorData);
        if (errorData.stage) {
          setInterpretation('The Neon connection works. The bootstrap query failed at the displayed stage.');
        } else {
          setInterpretation('Vercel can see DATABASE_URL, but Neon rejected or could not complete the connection.');
        }
      }
    };

    const handleCopyDiagnostics = () => {
      const dbHealthStatus = databaseHealth.status || 'unknown';
      const isDbUrlPresent = databaseHealth.health?.databaseUrlPresent !== false ? 'yes' : 'no';
      const httpStatus = bootstrapFailure?.httpStatus || '500';
      const requestId = bootstrapFailure?.requestId || errorState?.requestId || 'N/A';
      const stage = bootstrapFailure?.stage || errorState?.stage || 'Unknown';
      const code = bootstrapFailure?.code || errorState?.code || 'Unknown';
      const message = safeStringify(bootstrapFailure?.message || errorState?.message || 'None');
      const detail = safeStringify(bootstrapFailure?.detail || errorState?.detail || 'None');
      const deploymentId = databaseHealth.health?.deploymentId || 'Unknown';

      const text = `SetList Bootstrap Failure
Database health: ${dbHealthStatus}
DATABASE_URL detected: ${isDbUrlPresent}
HTTP status: ${httpStatus}
Request ID: ${requestId}
Stage: ${stage}
PostgreSQL code: ${code}
Message: ${message}
Detail: ${detail}
Deployment ID: ${deploymentId}`;

      navigator.clipboard.writeText(text).then(() => {
        setCopiedDiagnostics(true);
        setTimeout(() => setCopiedDiagnostics(false), 2000);
      }).catch((err) => {
        console.warn('Clipboard write failed, likely due to iframe permissions:', err);
      });
    };

    const testBootstrapApi = async () => {
      setTestingBootstrap(true);
      setDiagnosticTitle('Direct Bootstrap API Test');
      setDiagnosticOpen(true);
      try {
        const response = await fetch('/api/bootstrap', {
          cache: 'no-store'
        });

        const text = await response.text();

        let body: unknown;

        try {
          body = JSON.parse(text);
        } catch {
          body = {
            rawResponse: text
          };
        }

        setBootstrapTestResult({
          httpStatus: response.status,
          ok: response.ok,
          body
        });
        setDiagnosticResult(body);
        if (response.ok) {
          setInterpretation('Direct bootstrap test succeeded. The API endpoints returned active data.');
        } else {
          setInterpretation('Direct bootstrap test failed with status ' + response.status + '. The API encountered a database or runtime error.');
        }
      } catch (e: any) {
        const errorData = { error: e.message };
        setBootstrapTestResult({
          ok: false,
          body: errorData
        });
        setDiagnosticResult(errorData);
        setInterpretation('Direct bootstrap test failed to reach the server. ' + e.message);
      } finally {
        setTestingBootstrap(false);
      }
    };

    // Dynamically choose message based on databaseHealth
    let healthStatusMessage = 'Retrieving connection status...';
    if (databaseHealth.status === 'variable-missing' || databaseHealth.health?.databaseUrlPresent === false) {
      healthStatusMessage = 'Vercel cannot see DATABASE_URL for this deployment. Confirm the variable is enabled for this deployment environment and redeploy.';
    } else if (databaseHealth.status === 'connection-failed') {
      healthStatusMessage = 'Vercel can see DATABASE_URL, but the Neon connection failed.';
    } else if (databaseHealth.status === 'connected') {
      healthStatusMessage = 'The Neon connection is healthy. The setlist query failed after connecting to the database.';
    } else if (databaseHealth.status === 'checking') {
      healthStatusMessage = 'Checking database connection health...';
    } else {
      healthStatusMessage = 'Unable to verify database health status.';
    }

    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-950/40 border border-red-500/20 flex items-center justify-center mb-4 text-red-500">
          <Icons.Warning size={32} />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">{errorState.message}</h1>
        
        <p className="text-zinc-400 max-w-lg mb-6 text-sm leading-relaxed">
          {healthStatusMessage}
        </p>

        {/* Connection & Bootstrap Status Header Panel */}
        <div className="mb-4 p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg max-w-lg text-left w-full space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-500 font-mono">Database Status:</span>
            <span className={`font-semibold font-mono ${
              databaseHealth.status === 'connected' ? 'text-emerald-400' :
              databaseHealth.status === 'connection-failed' ? 'text-rose-400' : 'text-amber-400'
            }`}>
              {databaseHealth.status === 'connected' ? 'Connected' :
               databaseHealth.status === 'connection-failed' ? 'Connection Failed' : 'Not Detected'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 font-mono">DATABASE_URL:</span>
            <span className="font-semibold font-mono text-zinc-200">
              {databaseHealth.health?.databaseUrlPresent !== false ? 'Detected' : 'Not Detected'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 font-mono">Bootstrap Status:</span>
            <span className="font-semibold font-mono text-rose-400">Failed</span>
          </div>
        </div>

        {/* Diagnostic Metadata Grid */}
        <div className="mb-6 p-4 bg-zinc-950 border border-zinc-800 rounded-lg max-w-lg text-left w-full space-y-2 text-xs">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Diagnostic Identifiers</h3>
          
          <div className="flex justify-between font-mono">
            <span className="text-zinc-500">HTTP Status:</span>
            <span className="text-zinc-300 font-semibold">{bootstrapFailure?.httpStatus || '500'}</span>
          </div>

          <div className="flex justify-between font-mono">
            <span className="text-zinc-500">Failing Stage:</span>
            <span className="text-amber-400 font-semibold">{bootstrapFailure?.stage || errorState?.stage || 'Unknown'}</span>
          </div>

          <div className="flex justify-between font-mono">
            <span className="text-zinc-500">PostgreSQL Code:</span>
            <span className="text-zinc-300 font-semibold">{bootstrapFailure?.code || errorState?.code || 'Unknown'}</span>
          </div>

          <div className="flex justify-between font-mono">
            <span className="text-zinc-500">Bootstrap Request ID:</span>
            <span className="text-zinc-300 select-all">{bootstrapFailure?.requestId || errorState?.requestId || 'N/A'}</span>
          </div>

          <div className="flex flex-col gap-1 border-t border-zinc-900 pt-2 mt-2 font-mono">
            <span className="text-zinc-500">Database Message:</span>
            <span className="text-zinc-200 bg-black/40 p-2 rounded border border-zinc-900 whitespace-pre-wrap break-all select-all font-sans text-xs">
              {safeStringify(bootstrapFailure?.message || errorState?.message || 'None')}
            </span>
          </div>

          {(bootstrapFailure?.detail || errorState?.detail) && (
            <div className="flex flex-col gap-1 font-mono">
              <span className="text-zinc-500">Database Detail:</span>
              <span className="text-zinc-300 bg-black/40 p-2 rounded border border-zinc-900 whitespace-pre-wrap break-all select-all font-sans text-xs">
                {safeStringify(bootstrapFailure?.detail || errorState?.detail)}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1 font-mono">
            <span className="text-zinc-500">Raw Bootstrap Response:</span>

            <pre className="text-zinc-300 bg-black/40 p-2 rounded border border-zinc-900 whitespace-pre-wrap break-all select-all font-mono text-xs max-h-64 overflow-auto">
              {diagnosticText(
                bootstrapFailure?.rawResponse,
                'No raw response captured'
              )}
            </pre>
          </div>

          {bootstrapFailure?.databaseTable && (
            <div className="flex justify-between font-mono">
              <span className="text-zinc-500">Database Table:</span>
              <span className="text-zinc-300">{bootstrapFailure.databaseTable}</span>
            </div>
          )}

          {bootstrapFailure?.databaseColumn && (
            <div className="flex justify-between font-mono">
              <span className="text-zinc-500">Database Column:</span>
              <span className="text-zinc-300">{bootstrapFailure.databaseColumn}</span>
            </div>
          )}

          {bootstrapFailure?.databaseConstraint && (
            <div className="flex justify-between font-mono">
              <span className="text-zinc-500">Database Constraint:</span>
              <span className="text-zinc-300">{bootstrapFailure.databaseConstraint}</span>
            </div>
          )}

          {bootstrapFailure?.hint && (
            <div className="flex flex-col gap-1 font-mono">
              <span className="text-zinc-500">Database Hint:</span>
              <span className="text-amber-300 bg-black/40 p-2 rounded border border-zinc-900 whitespace-pre-wrap break-all select-all font-sans text-xs">
                {safeStringify(bootstrapFailure.hint)}
              </span>
            </div>
          )}
        </div>

        {interpretation && (
          <div className="mb-6 p-4 bg-zinc-900 border border-zinc-800 rounded-lg max-w-lg text-left w-full">
            <div className="flex items-start gap-2.5">
              <Icons.Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1">Result Analysis</h4>
                <p className="text-sm text-zinc-200 font-medium">{interpretation}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 justify-center mb-6 max-w-2xl">
          <button
            onClick={() => {
              setInterpretation('');
              setDiagnosticResult(null);
              setDiagnosticOpen(false);
              loadData();
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all"
          >
            Retry Load
          </button>
          
          <button
            onClick={handleCopyDiagnostics}
            className="px-4 py-2 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
          >
            <Icons.Copy size={14} />
            {copiedDiagnostics ? 'Copied!' : 'Copy Bootstrap Diagnostics'}
          </button>

          <button
            onClick={testBootstrapApi}
            disabled={testingBootstrap}
            className="px-4 py-2 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          >
            {testingBootstrap ? 'Testing...' : 'Test Bootstrap API'}
          </button>

          <button
            onClick={handleCheckEnv}
            className="px-4 py-2 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-lg text-sm font-medium transition-all"
          >
            Check Health
          </button>

          <button
            onClick={handleCheckHealth}
            className="px-4 py-2 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-lg text-sm font-medium transition-all"
          >
            Test Database Health
          </button>

          <button
            onClick={handleGetDiagnostics}
            className="px-4 py-2 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-lg text-sm font-medium transition-all"
          >
            Open Diagnostics
          </button>
        </div>

        {diagnosticOpen && diagnosticResult && (
          <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-lg text-left overflow-hidden mb-6">
            <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{diagnosticTitle} API JSON Response</span>
              <button 
                onClick={() => setDiagnosticOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Icons.Close size={14} />
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-zinc-300 overflow-auto max-h-72 whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(diagnosticResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-300 font-sans overflow-hidden">
         {/* Upper Header */}
         <header className="h-[70px] bg-surface border-b border-white/5 px-6 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-6">
                  {/* Brand Logo and Title */}
                  <div className="flex items-center gap-3">
                      {bandSettings.logoUrl ? (
                          <img src={bandSettings.logoUrl} className="w-8 h-8 rounded bg-white object-contain" alt="Logo" />
                      ) : (
                          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-sm">S</div>
                      )}
                      <div>
                          <h1 className="text-sm font-bold text-zinc-100 tracking-tight">{bandSettings.name || 'SetList Flow'}</h1>
                          <p className="text-[10px] text-zinc-500 font-medium">Neon Integrated</p>
                      </div>
                  </div>

                  <div className="h-6 w-px bg-white/10"></div>

                  {/* Active Gig Selector Dropdown */}
                  <div className="flex items-center gap-3">
                      <select
                        value={activeGigId || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'CREATE_NEW') {
                            setNewGigName('');
                            setShowCreateGigModal(true);
                          } else {
                            if (isDirty) {
                              const confirmSwitch = window.confirm("You have unsaved changes. Are you sure you want to switch gigs without saving?");
                              if (!confirmSwitch) return;
                            }
                            loadData(val);
                          }
                        }}
                        className="bg-zinc-900 border border-zinc-800 text-xs rounded-lg px-3 py-1.5 font-medium text-white focus:outline-none focus:border-primary cursor-pointer hover:border-zinc-700 transition-colors"
                      >
                        <option value="" disabled>-- Select Gig --</option>
                        {gigs.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.gigDate || 'No Date'})
                          </option>
                        ))}
                        <option value="CREATE_NEW" className="text-primary font-bold">+ Create New Gig...</option>
                      </select>

                      {activeGigId && (
                        <div 
                           onClick={() => setShowGigDetails(true)}
                           className="flex flex-col cursor-pointer hover:bg-white/5 px-2.5 py-1 rounded transition-colors group border border-white/5 bg-zinc-950/40"
                           title="Click to edit gig details"
                        >
                            <div className="text-xs font-semibold text-zinc-300 group-hover:text-primary transition-colors flex items-center gap-1">
                               {gigDetails.name || 'Untitled Gig'} <Icons.Edit size={10} className="opacity-0 group-hover:opacity-100 text-primary"/>
                            </div>
                            <div className="text-[9px] text-zinc-500 flex items-center gap-2">
                                <span>{gigDetails.date || 'No Date'}</span>
                                <span>•</span>
                                <span>{gigDetails.location || 'No Location'}</span>
                            </div>
                        </div>
                      )}
                  </div>
              </div>

              <div className="flex items-center gap-2">
                  {/* Database Health Badge */}
                  <DatabaseHealthBadge healthResult={databaseHealth} />

                  {/* Autosave Status Badge */}
                  <button
                    onClick={() => setAutosaveModalOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 hover:bg-zinc-800/60 rounded-full border border-white/5 hover:border-white/10 text-[10px] font-medium mr-2 transition-all cursor-pointer"
                    title="Click to view Autosave Status Details & Diagnostics"
                  >
                    {autosaveStatus === 'saving' && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
                        <span className="text-zinc-500">Saving changes...</span>
                      </>
                    )}
                    {autosaveStatus === 'saved' && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        <span className="text-zinc-500">Saved to Neon</span>
                      </>
                    )}
                    {autosaveStatus === 'unsaved' && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
                        <span className="text-zinc-400">Unsaved changes</span>
                      </>
                    )}
                    {autosaveStatus === 'failed' && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                        <span className="text-red-400 font-bold">Autosave failed</span>
                      </>
                    )}
                  </button>

                  <button 
                     onClick={() => setShowBandSettings(true)}
                     className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
                     title="Band Settings"
                  >
                      <Icons.Settings size={20} />
                  </button>
                  
                  <div className="h-6 w-px bg-white/10 mx-1"></div>

                  <button 
                     onClick={() => saveChanges()}
                     className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${saveButtonState === 'saved' ? 'bg-green-600 text-white' : saveButtonState === 'saving' ? 'bg-yellow-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'}`}
                     disabled={!gigDetails.id || saveButtonState === 'saving'}
                  >
                      {saveButtonState === 'saved' ? <Icons.Check size={16}/> : <Icons.Save size={16} />}
                      {saveButtonState === 'saved' ? 'Saved' : saveButtonState === 'saving' ? 'Saving...' : 'Save Changes'}
                  </button>

                  <button 
                     onClick={() => setShowPDFOptions(true)}
                     className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-white hover:bg-indigo-500 transition-all shadow-lg shadow-primary/20"
                     disabled={sets.length === 0}
                  >
                      <Icons.Download size={16} />
                      Export PDF
                  </button>
              </div>
         </header>

         {/* Main Panel Content */}
         <div className="flex-1 flex overflow-hidden">
             {/* Left Song Library */}
             <SongLibrary 
                songs={songs}
                sets={sets}
                usage={usage}
                onImportClick={() => setShowImport(true)}
                onPlaySong={playSong}
                onUpdateSong={handleUpdateSong}
                onClearLibrary={requestClearLibrary}
                onEditSong={setEditingSong}
                onAddSongToSet={handleAddSongToSet}
             />

             {/* Right Set List Area */}
             {!gigDetails.id ? (
               <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[#0c0c0e]">
                 <Icons.Music size={40} className="text-zinc-700 mb-4" />
                 <h3 className="text-lg font-bold text-white mb-1">No Active Gig Selected</h3>
                 <p className="text-zinc-500 max-w-sm mb-4 text-xs">
                   Create your first gig to start arranging sets and tracking master library usage.
                 </p>
                 <button
                   onClick={() => {
                     setNewGigName('');
                     setShowCreateGigModal(true);
                   }}
                   className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-colors"
                 >
                   Create New Gig
                 </button>
               </div>
             ) : (
               <DndContext
                   sensors={sensors}
                   collisionDetection={closestCorners}
                   onDragStart={handleDragStart}
                   onDragOver={handleDragOver}
                   onDragEnd={handleDragEnd}
               >
                   <div className="flex-1 flex flex-col bg-[#0c0c0e] relative overflow-hidden">
                         {/* Horizontal Scroll Area */}
                         <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 custom-scrollbar">
                                <div className="flex gap-6 h-full min-w-max pb-4">
                                    {sets.map((set, i) => (
                                        <SetListColumn
                                            key={set.id}
                                            setList={set}
                                            setIndex={i}
                                            totalSets={sets.length}
                                            bandMembers={bandSettings.members}
                                            duplicateSongIds={duplicateSongIds}
                                            onRemoveSet={requestRemoveSet}
                                            onRemoveSong={removeSongFromSet}
                                            onUpdateNote={updateSongNote}
                                            onPlaySong={playSong}
                                            onUpdateSetDetails={updateSetDetails}
                                            onEditSong={setEditingSong}
                                            onAddSongToSet={handleAddSongToSet}
                                            draggingSetId={draggingSetId}
                                            setDraggingSetId={setDraggingSetId}
                                            setDropTargetId={setDropTargetId}
                                            setSetDropTargetId={setSetDropTargetId}
                                            onReorderSets={handleReorderSets}
                                            onRenameSet={handleRenameSet}
                                        />
                                    ))}

                                    {/* Add Set Button Area */}
                                    {sets.length < 5 && (
                                        <div className="w-[320px] flex items-center justify-center shrink-0">
                                            <button 
                                                onClick={addSet}
                                                className="group flex flex-col items-center justify-center w-full h-[200px] border-2 border-dashed border-zinc-800 hover:border-primary/50 rounded-xl transition-all bg-zinc-900/20 hover:bg-zinc-900/50"
                                            >
                                                <div className="w-12 h-12 rounded-full bg-zinc-800 group-hover:bg-primary/20 flex items-center justify-center mb-3 transition-colors">
                                                    <Icons.Plus size={24} className="text-zinc-500 group-hover:text-primary" />
                                                </div>
                                                <span className="text-zinc-500 font-medium group-hover:text-zinc-300">Add New Set</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                         </div>

                        {/* Drag Overlay */}
                        <DragOverlay dropAnimation={dropAnimation}>
                             {activeDragItem ? (
                                 activeDragItem.type === 'SET_COLUMN' ? (
                                     <div className="flex flex-col h-[500px] w-[320px] bg-surface rounded-xl border-2 border-primary/50 shadow-2xl opacity-90 overflow-hidden">
                                         <div className="p-3 border-b border-white/5 bg-zinc-900 flex items-center gap-3">
                                             <Icons.Grip size={20} className="text-primary" />
                                             <span className="font-bold text-white text-sm">{activeDragItem.data.name}</span>
                                         </div>
                                     </div>
                                 ) : activeDragItem.type === 'SET_SONG' ? (
                                      <div className="p-2.5 rounded-lg bg-surfaceHighlight border-2 border-primary/50 text-xs shadow-2xl font-medium text-white max-w-[280px]">
                                          {activeDragItem.data.title}
                                      </div>
                                 ) : activeDragItem.type === 'LIBRARY_SONG' ? (
                                      <div className="p-2.5 rounded-lg bg-surfaceHighlight border-2 border-primary/50 text-xs shadow-2xl font-medium text-white max-w-[280px]">
                                          {activeDragItem.data.title}
                                      </div>
                                 ) : null
                             ) : null}
                        </DragOverlay>
                   </div>
               </DndContext>
             )}
         </div>

         {/* --- CUSTOM MODALS & WINDOWS --- */}
         
         {/* Edit Song Modal */}
         <EditSongModal 
             isOpen={!!editingSong}
             song={editingSong}
             onClose={() => setEditingSong(null)}
             onSave={handleUpdateSong}
         />

         {/* PDF Options Modal */}
         <PDFOptionsModal 
             isOpen={showPDFOptions}
             onClose={() => setShowPDFOptions(false)}
             onGenerate={handleGeneratePDF}
         />

         {/* Band Settings Modal */}
         <BandSettingsModal 
             isOpen={showBandSettings}
             onClose={() => setShowBandSettings(false)}
             settings={bandSettings}
             databaseHealth={databaseHealth}
             onSave={(s) => {
                 setBandSettings(s);
                 markDirty();
             }}
         />

         {/* Edit Gig Details (Modal / Sidebar Overlay) */}
         {showGigDetails && gigDetails.id && (
             <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-none">
                  <div className="bg-surface border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                      <div className="p-4 border-b border-white/5 bg-zinc-900 flex justify-between items-center">
                          <h3 className="font-semibold text-white flex items-center gap-2"><Icons.Edit size={16}/> Edit Gig Details</h3>
                          <button onClick={() => setShowGigDetails(false)}><Icons.Close size={20} className="text-zinc-500"/></button>
                      </div>
                      
                      <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                           <div>
                              <label className="block text-xs text-zinc-500 mb-1">Gig Name</label>
                              <input 
                                 type="text"
                                 className="w-full bg-background border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none"
                                 value={gigDetails.name || ''}
                                 onChange={e => {
                                     setGigDetails({...gigDetails, name: e.target.value});
                                     markDirty();
                                 }}
                              />
                           </div>

                           <div>
                              <label className="block text-xs text-zinc-500 mb-1">Venue / Location</label>
                              <input 
                                 type="text"
                                 className="w-full bg-background border border-zinc-700 rounded p-2 text-sm text-white focus:border-primary outline-none"
                                 value={gigDetails.location || ''}
                                 onChange={e => {
                                     setGigDetails({...gigDetails, location: e.target.value});
                                     markDirty();
                                 }}
                                 placeholder="Stage, Club, Arena, etc."
                              />
                           </div>

                           <div className="grid grid-cols-2 gap-3">
                                <div>
                                   <label className="block text-xs text-zinc-500 mb-1">Gig Date</label>
                                   <input 
                                      type="date"
                                      className="w-full bg-background border border-zinc-700 rounded p-2 text-xs text-white focus:border-primary outline-none"
                                      value={gigDetails.date || ''}
                                      onChange={e => {
                                          setGigDetails({...gigDetails, date: e.target.value});
                                          markDirty();
                                      }}
                                   />
                                </div>
                                <div>
                                   <label className="block text-xs text-zinc-500 mb-1">Gig Status</label>
                                   <select
                                      className="w-full bg-background border border-zinc-700 rounded p-2 text-xs text-white focus:border-primary outline-none"
                                      value={gigDetails.status || 'Draft'}
                                      onChange={e => {
                                          setGigDetails({...gigDetails, status: e.target.value});
                                          markDirty();
                                      }}
                                   >
                                       <option value="Draft">Draft</option>
                                       <option value="Proposed">Proposed</option>
                                       <option value="Final">Final</option>
                                   </select>
                                </div>
                           </div>

                           <div className="grid grid-cols-2 gap-3">
                                <div>
                                   <label className="block text-xs text-zinc-500 mb-1 flex items-center gap-1"><Icons.Clock size={10}/> Arrival Time</label>
                                   <select
                                      className="w-full bg-background border border-zinc-700 rounded p-2 text-xs text-white focus:border-primary outline-none"
                                      value={gigDetails.arriveTime || ''}
                                      onChange={e => {
                                          setGigDetails({...gigDetails, arriveTime: e.target.value});
                                          markDirty();
                                      }}
                                   >
                                       {timeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                   </select>
                                </div>
                                <div>
                                   <label className="block text-xs text-zinc-500 mb-1 flex items-center gap-1"><Icons.Clock size={10}/> Start Time</label>
                                   <select
                                      className="w-full bg-background border border-zinc-700 rounded p-2 text-xs text-white focus:border-primary outline-none"
                                      value={gigDetails.startTime || ''}
                                      onChange={e => {
                                          setGigDetails({...gigDetails, startTime: e.target.value});
                                          markDirty();
                                      }}
                                   >
                                       {timeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                   </select>
                                </div>
                           </div>

                           <div>
                              <label className="block text-xs text-zinc-500 mb-1">Gig Production Notes</label>
                              <textarea 
                                 rows={3}
                                 className="w-full bg-background border border-zinc-700 rounded p-2 text-xs text-white focus:border-primary outline-none resize-none"
                                 value={gigDetails.notes || ''}
                                 onChange={e => {
                                     setGigDetails({...gigDetails, notes: e.target.value});
                                     markDirty();
                                 }}
                                 placeholder="Sound system, guest lists, catering, etc."
                              />
                           </div>

                           <div className="pt-2 flex justify-between gap-2 border-t border-white/5">
                               <button 
                                  onClick={async () => {
                                    if (window.confirm("Are you sure you want to delete this gig entirely? This will also cascade to all of its sets!")) {
                                      try {
                                        await deleteGig(gigDetails.id);
                                      } catch (err: any) {
                                        console.error("Failed to delete gig:", err);
                                        alert("Failed to delete gig: " + (err.message || String(err)));
                                      }
                                      setShowGigDetails(false);
                                      loadData();
                                    }
                                  }}
                                  className="px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-950/20 rounded border border-red-500/20"
                               >
                                   Delete Gig
                               </button>
                               <button 
                                  onClick={() => setShowGigDetails(false)}
                                  className="px-5 py-2 rounded-md text-xs font-medium bg-primary text-white hover:bg-indigo-500 transition-colors"
                               >
                                   Close
                               </button>
                           </div>
                      </div>
                  </div>
             </div>
         )}

         {/* Create New Gig Modal */}
         {showCreateGigModal && (
           <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-none">
             <div className="bg-surface border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-zinc-900 flex justify-between items-center">
                    <h3 className="font-semibold text-white">Create New Gig</h3>
                    <button onClick={() => setShowCreateGigModal(false)} disabled={creatingGigInProgress}>
                        <Icons.Close size={20} className="text-zinc-500"/>
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs text-zinc-500 mb-1">Gig Name</label>
                        <input 
                           type="text" 
                           placeholder="e.g. Summer Festival Main Stage" 
                           value={newGigName}
                           onChange={(e) => setNewGigName(e.target.value)}
                           className="w-full bg-background border border-zinc-700 rounded p-2.5 text-sm text-white focus:border-primary outline-none"
                           autoFocus
                           disabled={creatingGigInProgress}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                        <button 
                            onClick={() => setShowCreateGigModal(false)}
                            className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                            disabled={creatingGigInProgress}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleCreateNewGigSubmit}
                            className="px-5 py-2 rounded-md text-sm font-medium bg-primary text-white hover:bg-indigo-500 flex items-center gap-1"
                            disabled={creatingGigInProgress}
                        >
                            {creatingGigInProgress ? (
                              <>
                                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                Creating...
                              </>
                            ) : (
                              'Create Gig'
                            )}
                        </button>
                    </div>
                </div>
             </div>
           </div>
         )}

         {/* Autosave Troubleshooting & Diagnostics Modal */}
         {autosaveModalOpen && (
             <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
                     {/* Modal Header */}
                     <div className="p-4 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center shrink-0">
                         <h3 className="font-semibold text-white flex items-center gap-2 text-xs uppercase tracking-wider">
                             <Icons.Save size={14} className="text-primary"/>
                             Autosave Status & Diagnostics
                         </h3>
                         <button 
                           onClick={() => setAutosaveModalOpen(false)}
                           className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
                         >
                           <Icons.Close size={18}/>
                         </button>
                     </div>
                     
                     {/* Modal Content */}
                     <div className="p-5 overflow-y-auto space-y-4 max-h-[70vh] custom-scrollbar">
                         {/* Current Status Panel */}
                         <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800/80">
                             <div className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Sync Status</div>
                             <div className="text-base font-semibold text-white mt-1 flex items-center gap-2">
                                 {autosaveStatus === 'saving' && (
                                   <>
                                     <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                                     <span className="text-yellow-400">Saving Changes...</span>
                                   </>
                                 )}
                                 {autosaveStatus === 'saved' && (
                                   <>
                                     <span className="w-2 h-2 rounded-full bg-green-500" />
                                     <span className="text-emerald-400 font-bold">Successfully Synced</span>
                                   </>
                                 )}
                                 {autosaveStatus === 'unsaved' && (
                                   <>
                                     <span className="w-2 h-2 rounded-full bg-yellow-400" />
                                     <span className="text-yellow-400">Unsaved Changes Present</span>
                                   </>
                                 )}
                                 {autosaveStatus === 'failed' && (
                                   <>
                                     <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                     <span className="text-red-400 font-bold">Autosave Failed</span>
                                   </>
                                 )}
                             </div>
                             <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                                 {autosaveStatus === 'saved' && "All changes are safe in the cloud. We automatically save your gig edits, set lists, band settings, and songs to your Neon PostgreSQL database as you type."}
                                 {autosaveStatus === 'saving' && "We are currently transmitting your latest modifications to your live Neon PostgreSQL database. This should complete in a few seconds."}
                                 {autosaveStatus === 'unsaved' && "You have outstanding modifications in your browser. A save operation will trigger shortly, or you can manually save."}
                                 {autosaveStatus === 'failed' && "Your live database rejected the save. Your changes are temporarily saved in browser state but have NOT been written to Neon. Do not reload or close this tab, or you may lose your changes."}
                             </p>
                         </div>

                         {/* Error Details Section (only if failed or has error) */}
                         {autosaveError && (
                             <div className="space-y-3">
                                 <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-lg text-xs leading-relaxed space-y-2">
                                     <div className="flex items-center gap-1.5 text-red-400 font-semibold uppercase tracking-wider text-[10px]">
                                         <Icons.Warning size={14} />
                                         Error Details
                                     </div>
                                     <p className="text-red-200 font-medium font-mono text-xs break-words bg-red-950/40 p-2.5 rounded border border-red-900/20 leading-relaxed whitespace-pre-wrap">
                                         {autosaveError.message}
                                     </p>
                                     
                                     <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-red-900/10 font-mono text-zinc-400">
                                         {autosaveError.httpStatus && (
                                             <div>
                                                 <span className="text-zinc-500">HTTP Status:</span> <span className="text-zinc-300 font-medium">{autosaveError.httpStatus}</span>
                                             </div>
                                         )}
                                         {autosaveError.stage && (
                                             <div>
                                                 <span className="text-zinc-500">Failing Stage:</span> <span className="text-zinc-300 font-medium">{autosaveError.stage}</span>
                                             </div>
                                         )}
                                         {autosaveError.code && (
                                             <div>
                                                 <span className="text-zinc-500">Postgres Code:</span> <span className="text-zinc-300 font-medium">{autosaveError.code}</span>
                                             </div>
                                         )}
                                         {autosaveError.timestamp && (
                                             <div className="col-span-2">
                                                 <span className="text-zinc-500">Failed At:</span> <span className="text-zinc-300 font-medium">{autosaveError.timestamp.toLocaleTimeString()} ({autosaveError.timestamp.toLocaleDateString()})</span>
                                             </div>
                                         )}
                                     </div>

                                     {autosaveError.detail && (
                                         <div className="pt-2 border-t border-red-900/10 text-[11px] text-zinc-400">
                                             <span className="text-zinc-500 block mb-0.5">DB Constraint Detail:</span>
                                             <p className="bg-zinc-950 p-2 rounded border border-white/5 font-mono text-zinc-300 break-words max-h-[100px] overflow-y-auto custom-scrollbar">
                                                 {typeof autosaveError.detail === 'string' ? autosaveError.detail : JSON.stringify(autosaveError.detail, null, 2)}
                                             </p>
                                         </div>
                                     )}

                                     {autosaveError.rawResponse && autosaveError.rawResponse.trim() !== '' && !autosaveError.rawResponse.startsWith('{') && (
                                         <div className="pt-2 border-t border-red-900/10 text-[11px] text-zinc-400">
                                             <span className="text-zinc-500 block mb-0.5">Raw Server Response:</span>
                                             <pre className="bg-zinc-950 p-2 rounded border border-white/5 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-[100px] overflow-y-auto custom-scrollbar whitespace-pre-wrap select-all">
                                                 {autosaveError.rawResponse}
                                             </pre>
                                         </div>
                                     )}
                                 </div>
                             </div>
                         )}

                         {/* Troubleshooting checklist */}
                         <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-lg text-xs space-y-2.5">
                             <h4 className="font-semibold text-zinc-300 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                                 <Icons.Info size={12} className="text-primary" />
                                 Autosave Troubleshooting Checklist
                             </h4>
                             <ul className="space-y-2 text-zinc-400 list-disc pl-4 leading-relaxed">
                                 <li>
                                     <strong className="text-zinc-300">Verify Database Connectivity:</strong> Ensure that the database status badge is green. If the DB connection is broken, autosave will fail.
                                 </li>
                                 <li>
                                      <strong className="text-zinc-300">Foreign Key & Constraint Errors:</strong> If the error mentions constraints or missing parents (e.g. <code>violates foreign key constraint</code>), verify you have a valid active Gig selected and you are not adding a song with invalid values.
                                 </li>
                                 <li>
                                     <strong className="text-zinc-300">Schema Sync status:</strong> If database schema updates are pending, or if database tables are out of sync with the application code, the server won't accept the saved payload structure.
                                 </li>
                                 <li>
                                     <strong className="text-zinc-300">Vercel Serverless Limits:</strong> Free-tier database connections or platform request size/timeout limits might prevent the save handler from completing. Clicking <strong className="text-zinc-300">Force Retry Save</strong> might establish a fresh connection.
                                 </li>
                             </ul>
                         </div>
                     </div>

                     {/* Modal Footer Controls */}
                     <div className="flex gap-3 px-5 py-4 bg-zinc-900 border-t border-zinc-800 justify-end shrink-0">
                         <button
                           onClick={() => {
                             const text = [
                               `Autosave Diagnostics Report`,
                               `Status: \${autosaveStatus}`,
                               `Last Attempted At: \${autosaveError?.timestamp ? autosaveError.timestamp.toLocaleString() : 'N/A'}`,
                               `Error Message: \${autosaveError?.message || 'None'}`,
                               `HTTP Status: \${autosaveError?.httpStatus || 'N/A'}`,
                               `Failing Stage: \${autosaveError?.stage || 'N/A'}`,
                               `Error Code: \${autosaveError?.code || 'N/A'}`,
                               `Error Details: \${autosaveError?.detail || 'None'}`,
                               `Raw Response: \${autosaveError?.rawResponse || 'None'}`
                             ].join('\n');
                             
                             navigator.clipboard.writeText(text).then(() => {
                               setCopiedAutosaveDiagnostics(true);
                               setTimeout(() => setCopiedAutosaveDiagnostics(false), 2000);
                             });
                           }}
                           disabled={autosaveStatus === 'saving'}
                           className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 hover:text-white rounded text-xs font-semibold transition-all cursor-pointer"
                         >
                           {copiedAutosaveDiagnostics ? (
                             <>
                               <Icons.Check size={12} className="text-emerald-400" />
                               <span>Copied Report!</span>
                             </>
                           ) : (
                             <>
                               <Icons.Copy size={12} />
                               <span>Copy Diagnostics</span>
                             </>
                           )}
                         </button>
                         <button
                           onClick={async () => {
                             setAutosaveStatus('saving');
                             const success = await saveChanges();
                             if (success) {
                               setAutosaveModalOpen(false);
                             }
                           }}
                           disabled={autosaveStatus === 'saving'}
                           className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:opacity-60 text-white rounded text-xs font-semibold transition-all cursor-pointer"
                         >
                           <Icons.Refresh size={12} className={autosaveStatus === 'saving' ? 'animate-spin' : ''} />
                           {autosaveStatus === 'saving' ? 'Saving...' : 'Force Retry Save'}
                         </button>
                     </div>
                 </div>
             </div>
         )}
\n         {/* Paste/Import CSV Modal */}
         {showImport && (
             <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                  <div className="bg-surface border border-white/10 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                     <div className="p-4 border-b border-white/5 bg-zinc-900 flex justify-between shrink-0">
                         <h3 className="font-semibold text-white flex items-center gap-2">
                             <Icons.Download size={18} className="text-primary"/>
                             Import Song Library CSV
                         </h3>
                         <button onClick={() => setShowImport(false)}><Icons.Close size={20} className="text-zinc-500"/></button>
                     </div>
                     
                     <div className="p-6 overflow-y-auto space-y-4 custom-scrollbar">
                         <p className="text-xs text-zinc-500">
                             Choose a CSV file from your device, drag it into the box below, or paste raw CSV text directly. The CSV must contain at least the <strong>Title</strong> and <strong>Artist</strong> columns (other columns like <strong>Duration (Seconds)</strong>, <strong>Video URL</strong>, <strong>Status</strong>, <strong>Key</strong>, <strong>Tempo</strong>, and <strong>Notes</strong> are optional).
                         </p>

                         {/* Drag and Drop Zone */}
                         <div 
                             onDragOver={(e) => {
                                 e.preventDefault();
                                 setIsDragging(true);
                             }}
                             onDragLeave={() => {
                                 setIsDragging(false);
                             }}
                             onDrop={(e) => {
                                 e.preventDefault();
                                 setIsDragging(false);
                                 if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                     const file = e.dataTransfer.files[0];
                                     const reader = new FileReader();
                                     reader.onload = (ev) => {
                                         const text = ev.target?.result;
                                         if (typeof text === 'string') {
                                             setImportText(text);
                                         }
                                     };
                                     reader.readAsText(file);
                                 }
                             }}
                             className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer ${
                                 isDragging 
                                     ? 'border-primary bg-primary/10 scale-[1.01]' 
                                     : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/30 hover:bg-zinc-900/50'
                             }`}
                         >
                             <input 
                                 type="file" 
                                 id="csv-file-upload"
                                 accept=".csv,text/csv" 
                                 className="hidden" 
                                 onChange={e => {
                                     if (e.target.files && e.target.files[0]) {
                                         const file = e.target.files[0];
                                         const reader = new FileReader();
                                         reader.onload = (ev) => {
                                             const text = ev.target?.result;
                                             if (typeof text === 'string') {
                                                 setImportText(text);
                                             }
                                         };
                                         reader.readAsText(file);
                                     }
                                 }}
                             />
                             <label htmlFor="csv-file-upload" className="flex flex-col items-center justify-center w-full h-full cursor-pointer text-center">
                                 <Icons.Download size={32} className={`mb-3 ${isDragging ? 'text-primary animate-bounce' : 'text-zinc-500'}`} />
                                 <p className="text-sm font-semibold text-zinc-200">
                                     Drag and drop your CSV file here, or <span className="text-primary hover:underline">browse files</span>
                                 </p>
                                 <p className="text-xs text-zinc-500 mt-1">
                                     Supports standard CSV or TSV files
                                 </p>
                             </label>
                         </div>

                         <div className="flex items-center gap-4 my-2">
                             <div className="h-px bg-white/10 flex-1"></div>
                             <span className="text-[10px] uppercase font-bold text-zinc-600 tracking-wider">Or paste raw CSV text</span>
                             <div className="h-px bg-white/10 flex-1"></div>
                         </div>

                         {false && (
                             <button 
                                 onClick={handleFetchFromUrl}
                                 className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded border border-white/5 font-semibold flex items-center gap-1.5 transition-colors"
                             >
                                 <Icons.Globe size={14}/> Load Default Library Spreadsheet
                             </button>
                         )}

                         <textarea 
                             rows={12}
                             value={importText}
                             onChange={e => setImportText(e.target.value)}
                             className="w-full bg-background border border-zinc-800 rounded-lg p-4 text-xs font-mono text-zinc-300 focus:border-primary outline-none"
                             placeholder="Title,Artist,Duration (Seconds),Video URL...&#10;My Song,The Band,240,https://..."
                         />

                          {importSaveStatus !== 'idle' && (
                              <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${importSaveStatus === 'saving' ? 'bg-zinc-800/50 border-zinc-700 text-zinc-300 animate-pulse' : importSaveStatus === 'saved' ? 'bg-emerald-950/30 border-emerald-800 text-emerald-400' : 'bg-red-950/30 border-red-800 text-red-400'}`}>
                                  {importSaveStatus === 'saving' && (
                                      <>
                                          <Icons.Refresh size={14} className="animate-spin text-zinc-400"/>
                                          <span>Saving imported songs...</span>
                                      </>
                                  )}
                                  {importSaveStatus === 'saved' && (
                                      <>
                                          <Icons.Check size={14} className="text-emerald-400"/>
                                          <span>Imported songs saved to Neon.</span>
                                      </>
                                  )}
                                  {(importSaveStatus === 'failed' || importSaveStatus === 'error') && (
                                      <>
                                          <Icons.Warning size={14} className="text-red-400"/>
                                          <span>Save failed: {importSaveError}</span>
                                      </>
                                  )}
                              </div>
                          )}
                     </div>

                     <div className="p-4 border-t border-white/5 flex justify-end gap-2 bg-zinc-900 shrink-0">
                         <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-zinc-400">Cancel</button>
                         <button onClick={() => handleImport('add')} className="px-4 py-2 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md">Append New</button>
                         <button onClick={() => handleImport('replace')} className="px-5 py-2 text-sm font-medium bg-primary text-white hover:bg-indigo-500 rounded-md">Match & Update All</button>
                     </div>
                  </div>
             </div>
         )}

         {/* Unified Confirmation Dialog */}
         <ConfirmationModal 
             isOpen={!!confirmState}
             state={confirmState}
             onClose={() => setConfirmState(null)}
             onConfirm={handleConfirmAction}
         />

         {clientRuntimeError && (
             <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6 animate-none">
               <div className="w-full max-w-3xl rounded-xl border border-red-900 bg-zinc-950 p-6 text-left">
                 <h2 className="text-xl font-bold text-red-400 mb-3">
                   Browser runtime error
                 </h2>

                 <pre className="rounded bg-black border border-zinc-800 p-4 text-sm text-red-300 whitespace-pre-wrap break-words">
                   {clientRuntimeError.message}
                 </pre>

                 {clientRuntimeError.source && (
                   <p className="mt-3 text-xs text-zinc-500">
                     {clientRuntimeError.source}
                   </p>
                 )}

                 {clientRuntimeError.stack && (
                   <pre className="mt-3 max-h-64 overflow-auto rounded bg-black border border-zinc-800 p-4 text-xs text-zinc-300 whitespace-pre-wrap break-words">
                     {clientRuntimeError.stack}
                   </pre>
                 )}

                 <div className="mt-4 flex gap-3">
                   <button
                     type="button"
                     className="rounded bg-primary px-4 py-2 text-white font-medium"
                     onClick={() =>
                       setClientRuntimeError(null)
                     }
                   >
                     Close
                   </button>

                   <button
                     type="button"
                     className="rounded bg-zinc-800 px-4 py-2 text-white font-medium"
                     onClick={() =>
                       window.location.reload()
                     }
                   >
                     Reload
                   </button>
                 </div>
               </div>
             </div>
         )}
    </div>
  );
}
