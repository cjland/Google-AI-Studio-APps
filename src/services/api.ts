import { Song, SetList, GigDetails, BandSettings } from '@/types';

export interface ApiErrorPayload {
  ok?: boolean;
  error?: unknown;
  requestId?: string | null;
  stage?: string | null;
  code?: string | null;
  message?: unknown;
  detail?: unknown;
  hint?: unknown;
  databaseTable?: string | null;
  databaseColumn?: string | null;
  databaseConstraint?: string | null;
  httpStatus?: number;
  statusText?: string;
  contentType?: string | null;
  rawResponse?: string;
  normalizedMessage?: string;

  databaseError?: {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    detail?: unknown;
    hint?: unknown;
    table?: unknown;
    column?: unknown;
    constraint?: unknown;
    schema?: unknown;
  };
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

function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
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

function findErrorMessage(payload: any): string {
  const candidates = [
    payload?.databaseError?.message,
    payload?.message?.message,
    payload?.message,
    payload?.error?.message,
    payload?.error,
    payload?.detail?.message,
    payload?.detail
  ];

  for (const candidate of candidates) {
    const text = stringifyUnknown(candidate);

    if (text && text !== '{}' && text !== '[object Object]') {
      return text;
    }
  }

  return 'Unknown API error';
}

// Shared safe response parser
async function handleResponse(response: Response) {
  const rawBody = await response.text();

  let payload: any = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {
        rawResponse: rawBody
      };
    }
  }

  if (!response.ok) {
    const message = findErrorMessage(payload);

    const normalizedPayload = {
      ...(payload && typeof payload === 'object' ? payload : {}),
      httpStatus: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      rawResponse: rawBody,
      normalizedMessage: message
    };

    throw new ApiRequestError(
      message || `Request failed with status ${response.status}`,
      response.status,
      normalizedPayload
    );
  }

  return payload;
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

export interface SaveStateGigPayload {
  id: string;
  name: string;
  location: string;
  gigDate: string;
  startTime: string;
  arriveTime?: string;
  notes?: string;
  status?: string;
}

export interface SaveStatePayload {
  bandSettings: BandSettings;
  songs: Song[];
  gig: SaveStateGigPayload;
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
  
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { rawResponse: text };
  }

  if (!res.ok) {
    const msg = parsed.message || parsed.error || parsed.detail || `Save state failed with status ${res.status}`;
    const detailedMsg = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const stagePrefix = parsed.stage ? `[Stage: ${parsed.stage}] ` : '';
    const codeSuffix = parsed.code ? ` (Code: ${parsed.code})` : '';
    const detailSuffix = parsed.detail ? ` - Detail: ${typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)}` : '';
    const errorInstance = new Error(`${stagePrefix}${detailedMsg}${codeSuffix}${detailSuffix}`);
    (errorInstance as any).stage = parsed.stage || null;
    (errorInstance as any).code = parsed.code || null;
    (errorInstance as any).detail = parsed.detail || parsed.error || null;
    (errorInstance as any).httpStatus = res.status;
    (errorInstance as any).rawResponse = text;
    throw errorInstance;
  }
  return parsed;
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
