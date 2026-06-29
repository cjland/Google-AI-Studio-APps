import { Song, SetList, GigDetails, BandSettings } from '@/types';

export interface ApiErrorPayload {
  ok?: boolean;
  error?: string;
  requestId?: string | null;
  stage?: string | null;
  code?: string | null;
  message?: string | null;
  detail?: string | null;
  databaseTable?: string | null;
  databaseColumn?: string | null;
  databaseConstraint?: string | null;
}

export class ApiRequestError extends Error {
  status: number;
  payload: ApiErrorPayload | null;

  constructor(
    message: string,
    status: number,
    payload: ApiErrorPayload | null
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

// Shared safe response parser
async function handleResponse(response: Response) {
  let json: any = null;
  const contentType = response.headers.get('content-type');

  try {
    if (contentType && contentType.includes('application/json')) {
      json = await response.json();
    }
  } catch (err) {
    console.error('Failed to parse response JSON:', err);
  }

  if (!response.ok) {
    const payload = json as ApiErrorPayload | null;

    const message =
      payload?.message ||
      payload?.detail ||
      payload?.error ||
      `Request failed with status ${response.status}`;

    throw new ApiRequestError(
      message,
      response.status,
      payload
    );
  }

  return json;
}

export type DatabaseHealthStatus =
  | 'checking'
  | 'connected'
  | 'variable-missing'
  | 'connection-failed'
  | 'unknown';

export interface DatabaseHealthResponse {
  ok: boolean;
  status: DatabaseHealthStatus;
  databaseUrlPresent?: boolean;
  database?: string;
  databaseTime?: string | null;
  environment?: string | null;
  region?: string | null;
  deploymentId?: string | null;
  requestId?: string;
  code?: string | null;
  error?: string | null;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthResponse> {
  const response = await fetch('/api/health', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  let payload: DatabaseHealthResponse;

  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Database health returned a non-JSON response with status ${response.status}.`
    );
  }

  return payload;
}

export async function checkHealth() {
  const res = await fetch('/api/health');
  return handleResponse(res);
}

export async function checkEnv() {
  const res = await fetch('/api/env-check');
  return handleResponse(res);
}

export async function getDiagnostics() {
  const res = await fetch('/api/diagnostics');
  return handleResponse(res);
}

export async function loadBootstrap(gigId?: string) {
  const url = gigId ? `/api/bootstrap?gigId=${encodeURIComponent(gigId)}` : '/api/bootstrap';
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json'
    }
  });
  return handleResponse(res);
}

export interface SaveStatePayload {
  bandSettings: BandSettings;
  songs: Song[];
  gig: GigDetails & { id: string; status?: string };
  sets: SetList[];
}

export async function saveState(payload: SaveStatePayload) {
  const res = await fetch('/api/save-state', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getGigs() {
  const res = await fetch('/api/gigs');
  return handleResponse(res);
}

export interface CreateGigPayload {
  name: string;
  location?: string;
  gigDate?: string;
  startTime?: string;
  arriveTime?: string;
  notes?: string;
  status?: string;
}

export async function createGig(payload: CreateGigPayload) {
  const res = await fetch('/api/gigs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function updateGig(id: string, payload: Partial<CreateGigPayload>) {
  const res = await fetch('/api/gigs', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, ...payload }),
  });
  return handleResponse(res);
}

export async function deleteGig(id: string) {
  const res = await fetch(`/api/gigs?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleResponse(res);
}
