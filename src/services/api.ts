import {
  Song,
  SetList,
  GigDetails,
  BandSettings
} from '@/types';

export interface ApiErrorPayload {
  ok?: boolean;
  apiVersion?: string | null;
  error?: unknown;
  requestId?: string | null;
  stage?: string | null;
  code?: string | null;
  message?: unknown;
  detail?: unknown;
  hint?: unknown;
  severity?: unknown;
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
    severity?: unknown;
    table?: unknown;
    column?: unknown;
    constraint?: unknown;
    schema?: unknown;
    cause?: unknown;
    raw?: unknown;
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

    Object.setPrototypeOf(
      this,
      ApiRequestError.prototype
    );
  }
}

function stringifyUnknown(
  value: unknown
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isUsefulMessage(
  value: string
): boolean {
  const normalized = value.trim();

  return Boolean(
    normalized &&
    normalized !== '{}' &&
    normalized !== '[]' &&
    normalized !== '[object Object]' &&
    normalized !== 'null' &&
    normalized !== 'undefined'
  );
}

function findErrorMessage(
  payload: any,
  fallback: string
): string {
  const candidates = [
    payload?.databaseError?.message,
    payload?.message?.message,
    payload?.message,
    payload?.databaseError?.detail,
    payload?.detail?.message,
    payload?.detail,
    payload?.error?.message,
    payload?.error,
    payload?.databaseError?.raw,
    payload?.rawResponse
  ];

  for (const candidate of candidates) {
    const text = stringifyUnknown(candidate);

    if (isUsefulMessage(text)) {
      return text;
    }
  }

  return fallback;
}

async function handleResponse<T = any>(
  response: Response
): Promise<T> {
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
    const fallback =
      `Request failed with HTTP ${response.status}` +
      (
        response.statusText
          ? ` ${response.statusText}`
          : ''
      );

    const message = findErrorMessage(
      payload,
      fallback
    );

    const normalizedPayload: ApiErrorPayload = {
      ...(
        payload &&
        typeof payload === 'object'
          ? payload
          : {}
      ),
      httpStatus: response.status,
      statusText: response.statusText,
      contentType:
        response.headers.get('content-type'),
      rawResponse: rawBody,
      normalizedMessage: message
    };

    throw new ApiRequestError(
      message,
      response.status,
      normalizedPayload
    );
  }

  return payload as T;
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

export async function checkDatabaseHealth():
Promise<DatabaseHealthResponse> {
  const response = await fetch(
    `/api/health?_=${Date.now()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store'
    }
  );

  return handleResponse<DatabaseHealthResponse>(
    response
  );
}

export async function checkHealth() {
  const response = await fetch(
    `/api/health?_=${Date.now()}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  return handleResponse(response);
}

export async function checkEnv() {
  const response = await fetch(
    `/api/env-check?_=${Date.now()}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  return handleResponse(response);
}

export async function getDiagnostics() {
  const response = await fetch(
    `/api/diagnostics?_=${Date.now()}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  return handleResponse(response);
}

export async function loadBootstrap(
  gigId?: string
) {
  const params = new URLSearchParams();

  params.set('_', String(Date.now()));

  if (gigId) {
    params.set('gigId', gigId);
  }

  const response = await fetch(
    `/api/bootstrap?${params.toString()}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache'
      }
    }
  );

  return handleResponse(response);
}

export interface SaveStatePayload {
  bandSettings: BandSettings;
  songs: Song[];
  gig: GigDetails & {
    id: string;
    status?: string;
  };
  sets: SetList[];
}

export async function saveState(
  payload: SaveStatePayload
) {
  const response = await fetch(
    '/api/save-state',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  return handleResponse(response);
}

export async function getGigs() {
  const response = await fetch(
    `/api/gigs?_=${Date.now()}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  return handleResponse(response);
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

export async function createGig(
  payload: CreateGigPayload
) {
  const response = await fetch(
    '/api/gigs',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  return handleResponse(response);
}

export async function updateGig(
  id: string,
  payload: Partial<CreateGigPayload>
) {
  const response = await fetch(
    '/api/gigs',
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        id,
        ...payload
      })
    }
  );

  return handleResponse(response);
}

export async function deleteGig(
  id: string
) {
  const response = await fetch(
    `/api/gigs?id=${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  return handleResponse(response);
}