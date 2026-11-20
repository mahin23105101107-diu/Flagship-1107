import type { PublicUser } from '../types/flagship';
import { handleLocalApiRequest } from './localBackend';

const TOKEN_KEY = 'flagship_auth_token';
const USER_KEY = 'flagship_auth_user';

export interface ProblemDetails {
  title?: string;
  status?: number;
  detail?: string;
}

export class ApiError extends Error {
  status: number;
  title: string;
  constructor(status: number, title: string, detail: string) {
    super(detail);
    this.status = status;
    this.title = title;
  }
}

let runtimeStaticFallback = false;

export function isStaticMode(): boolean {
  if (runtimeStaticFallback) return true;
  if (import.meta.env.VITE_STATIC_MODE === 'true') return true;
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')) {
    return true;
  }
  return false;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(token: string, user: PublicUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // Ignore
  }
}

async function runLocalRequest<T>(
  path: string,
  options: RequestInit,
  headers: Record<string, string>,
): Promise<T> {
  try {
    return await handleLocalApiRequest<T>(path, options, headers);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && 'title' in err) {
      const e = err as { status: number; title: string; message: string };
      throw new ApiError(e.status, e.title, e.message);
    }
    throw new ApiError(500, 'Local Engine Error', err instanceof Error ? err.message : 'Request failed');
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  if (isStaticMode()) {
    return runLocalRequest<T>(path, options, headers);
  }

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
    });
  } catch {
    runtimeStaticFallback = true;
    return runLocalRequest<T>(path, options, headers);
  }

  const contentType = res.headers.get('content-type') || '';
  if (res.status === 404 && !contentType.includes('application/json')) {
    runtimeStaticFallback = true;
    return runLocalRequest<T>(path, options, headers);
  }

  if (!res.ok) {
    let body: ProblemDetails = {};
    try {
      body = (await res.json()) as ProblemDetails;
    } catch {
      // Non-JSON error
    }
    throw new ApiError(
      res.status,
      body.title || `HTTP ${res.status}`,
      body.detail || res.statusText || 'Request failed',
    );
  }

  return (await res.json()) as T;
}
