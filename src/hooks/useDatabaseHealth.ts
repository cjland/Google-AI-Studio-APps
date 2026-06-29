import { useState, useEffect, useCallback, useRef } from 'react';
import { checkDatabaseHealth, DatabaseHealthResponse, DatabaseHealthStatus } from '../services/api';

export interface UseDatabaseHealthResult {
  health: DatabaseHealthResponse | null;
  status: DatabaseHealthStatus;
  checking: boolean;
  lastCheckedAt: Date | null;
  refreshHealth: () => Promise<void>;
}

export function useDatabaseHealth(): UseDatabaseHealthResult {
  const [health, setHealth] = useState<DatabaseHealthResponse | null>(null);
  const [status, setStatus] = useState<DatabaseHealthStatus>('checking');
  const [checking, setChecking] = useState<boolean>(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  
  const lastCheckedRef = useRef<Date | null>(null);
  const isCheckingRef = useRef<boolean>(false);

  const refreshHealthInternal = useCallback(async (force = false) => {
    if (isCheckingRef.current) return;

    if (!force && lastCheckedRef.current) {
      const timeSinceLastCheck = Date.now() - lastCheckedRef.current.getTime();
      if (timeSinceLastCheck < 60000) {
        return;
      }
    }

    isCheckingRef.current = true;
    setChecking(true);
    try {
      const res = await checkDatabaseHealth();
      setHealth(res);
      setStatus(res.status || 'unknown');
      const now = new Date();
      setLastCheckedAt(now);
      lastCheckedRef.current = now;
    } catch (err: any) {
      console.error('Failed to fetch database health:', err);
      const fallbackResponse: DatabaseHealthResponse = {
        ok: false,
        status: 'connection-failed',
        error: err?.message || 'Failed to fetch database health API'
      };
      setHealth(fallbackResponse);
      setStatus('connection-failed');
      const now = new Date();
      setLastCheckedAt(now);
      lastCheckedRef.current = now;
    } finally {
      setChecking(false);
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refreshHealthInternal(true);

    const interval = setInterval(() => {
      refreshHealthInternal(false);
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [refreshHealthInternal]);

  const refreshHealth = useCallback(async () => {
    await refreshHealthInternal(true);
  }, [refreshHealthInternal]);

  return {
    health,
    status,
    checking,
    lastCheckedAt,
    refreshHealth
  };
}
