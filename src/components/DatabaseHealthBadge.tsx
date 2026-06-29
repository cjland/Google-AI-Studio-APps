import React, { useState } from 'react';
import { UseDatabaseHealthResult } from '../hooks/useDatabaseHealth';
import { Icons } from '../../components/ui/Icons';

interface DatabaseHealthBadgeProps {
  healthResult: UseDatabaseHealthResult;
}

export const DatabaseHealthBadge: React.FC<DatabaseHealthBadgeProps> = ({ healthResult }) => {
  const { health, status, checking, lastCheckedAt, refreshHealth } = healthResult;
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Determine badge styling based on status
  let badgeColorClass = 'bg-zinc-500';
  let badgeContainerClass = 'text-zinc-400 bg-zinc-900 border-zinc-800 hover:bg-zinc-800';
  let label = 'Checking...';

  if (status === 'checking') {
    badgeColorClass = 'bg-blue-500 animate-pulse';
    badgeContainerClass = 'text-blue-400 bg-blue-950/20 border-blue-900/30 hover:bg-blue-950/45';
    label = 'Checking...';
  } else if (status === 'connected') {
    badgeColorClass = 'bg-emerald-500';
    badgeContainerClass = 'text-emerald-400 bg-emerald-950/20 border-emerald-900/30 hover:bg-emerald-950/45';
    label = 'Connected';
  } else if (status === 'variable-missing') {
    badgeColorClass = 'bg-amber-500';
    badgeContainerClass = 'text-amber-400 bg-amber-950/20 border-amber-900/30 hover:bg-amber-950/45';
    label = 'Variable Missing';
  } else if (status === 'connection-failed') {
    badgeColorClass = 'bg-rose-500';
    badgeContainerClass = 'text-rose-400 bg-rose-950/20 border-rose-900/30 hover:bg-rose-950/45';
    label = 'Connection Failed';
  }

  const handleCopy = () => {
    const text = [
      `Database Health Status`,
      `Status: ${health?.status || status}`,
      `DATABASE_URL detected: ${health?.databaseUrlPresent !== false ? 'Yes' : 'No'}`,
      `Environment: ${health?.environment || 'unknown'}`,
      `Region: ${health?.region || 'unknown'}`,
      `Deployment ID: ${health?.deploymentId || 'N/A'}`,
      `Request ID: ${health?.requestId || 'N/A'}`,
      `Error: ${health?.error || 'N/A'}`,
      `Error code: ${health?.code || 'N/A'}`,
      `Last checked: ${lastCheckedAt ? lastCheckedAt.toLocaleString() : 'Never'}`
    ].join('\n');
    
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  const getEnvDisplayName = (env: string | null | undefined) => {
    if (!env) return 'Unknown';
    if (env.toLowerCase() === 'production') return 'Production';
    if (env.toLowerCase() === 'preview') return 'Preview';
    if (env.toLowerCase() === 'development') return 'Development';
    return env;
  };

  return (
    <>
      {/* Small Badge Trigger */}
      <button
        onClick={() => setModalOpen(true)}
        className={`flex items-center gap-2 px-2.5 py-1 text-xs font-medium border rounded-full transition-all duration-200 cursor-pointer ${badgeContainerClass}`}
        title="View Database Status Details"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${badgeColorClass}`} />
        <span>
          <span className="hidden sm:inline">DB {label}</span>
          <span className="sm:hidden">DB</span>
        </span>
      </button>

      {/* Detail Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-zinc-900 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${badgeColorClass}`} />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Database Health Status</h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Icons.Close size={16} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4">
              {/* Main Status Text */}
              <div className="p-3 bg-zinc-900/50 border border-zinc-800/80 rounded-lg">
                <div className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Current Status</div>
                <div className="text-base font-semibold text-white mt-0.5 flex items-center gap-1.5">
                  {status === 'connected' && <Icons.Check size={16} className="text-emerald-400 shrink-0" />}
                  {status === 'checking' && <Icons.Refresh size={14} className="text-blue-400 shrink-0 animate-spin" />}
                  {(status === 'connection-failed' || status === 'variable-missing') && <Icons.Warning size={16} className="text-rose-400 shrink-0" />}
                  {status === 'connected' && 'Connected to Neon'}
                  {status === 'checking' && 'Checking database availability...'}
                  {status === 'variable-missing' && 'DATABASE_URL Missing'}
                  {status === 'connection-failed' && 'Connection Failed'}
                </div>
                <div className="text-xs text-zinc-400 mt-1">
                  {status === 'connected' && 'DATABASE_URL detected & Neon database connection successful.'}
                  {status === 'checking' && 'Checking server environment variables and attempting Neon ping.'}
                  {status === 'variable-missing' && 'DATABASE_URL is not available to this deployment environment.'}
                  {status === 'connection-failed' && 'DATABASE_URL is present, but Neon connection rejected or failed.'}
                </div>
              </div>

              {/* Warning for Preview Environment */}
              {health?.environment === 'preview' && (
                <div className="p-3 bg-amber-950/10 border border-amber-900/30 text-amber-400 rounded-lg text-xs leading-relaxed flex items-start gap-2">
                  <Icons.Warning size={14} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>This is a Preview deployment.</strong> Confirm that the <code>DATABASE_URL</code> environment variable has been enabled for the <strong>Preview</strong> environment in your Vercel project settings and redeployed.
                  </span>
                </div>
              )}

              {/* Grid Details */}
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs">
                <div>
                  <span className="text-zinc-500">DATABASE_URL Present:</span>
                  <p className="font-semibold text-zinc-300 mt-0.5">
                    {health?.databaseUrlPresent !== false ? 'Yes' : 'No'}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">Environment:</span>
                  <p className="font-semibold text-zinc-300 mt-0.5">
                    {getEnvDisplayName(health?.environment)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">Vercel Region:</span>
                  <p className="font-semibold text-zinc-300 mt-0.5">
                    {health?.region || 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">Deployment:</span>
                  <p className="font-semibold text-zinc-300 mt-0.5 truncate" title={health?.deploymentId || undefined}>
                    {health?.deploymentId || 'N/A'}
                  </p>
                </div>
                {health?.databaseTime && (
                  <div className="col-span-2 border-t border-zinc-900 pt-2.5">
                    <span className="text-zinc-500">Database Server Time:</span>
                    <p className="font-mono text-[11px] text-zinc-300 mt-0.5 truncate">
                      {health.databaseTime}
                    </p>
                  </div>
                )}
                {lastCheckedAt && (
                  <div className="col-span-2 border-t border-zinc-900 pt-2.5">
                    <span className="text-zinc-500">Last Checked At:</span>
                    <p className="font-semibold text-zinc-300 mt-0.5">
                      {lastCheckedAt.toLocaleTimeString()} ({lastCheckedAt.toLocaleDateString()})
                    </p>
                  </div>
                )}
                {health?.requestId && (
                  <div className="col-span-2 border-t border-zinc-900 pt-2.5">
                    <span className="text-zinc-500">Health Check Request ID:</span>
                    <p className="font-mono text-[10px] text-zinc-400 mt-0.5 select-all truncate">
                      {health.requestId}
                    </p>
                  </div>
                )}
                {health?.error && (
                  <div className="col-span-2 border-t border-zinc-900 pt-2.5">
                    <span className="text-rose-500 font-medium">Error Details:</span>
                    <p className="text-xs text-rose-400/90 mt-0.5 whitespace-pre-wrap leading-relaxed">
                      {health.error} {health.code ? `(Code: ${health.code})` : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="flex gap-3 px-5 py-4 bg-zinc-900 border-t border-zinc-800 justify-end">
              <button
                onClick={handleCopy}
                disabled={checking}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 hover:text-white rounded text-xs font-semibold transition-all cursor-pointer"
              >
                {copied ? <Icons.Check size={12} className="text-emerald-400" /> : <Icons.Copy size={12} />}
                {copied ? 'Copied' : 'Copy Diagnostics'}
              </button>
              <button
                onClick={() => refreshHealth()}
                disabled={checking}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-750 disabled:opacity-60 text-white rounded text-xs font-semibold transition-all cursor-pointer"
              >
                <Icons.Refresh size={12} className={checking ? 'animate-spin' : ''} />
                {checking ? 'Checking...' : 'Run Health Check'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
