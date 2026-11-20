import type { PublicUser } from '../types/flagship';

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

  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
  });

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
