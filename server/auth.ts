import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { PublicUser, Role, User } from '../src/types/flagship';

const JWT_SECRET =
  process.env.FLAGSHIP_JWT_SECRET ||
  crypto.createHash('sha256').update('flagship-dev-ephemeral-signing-key-2026').digest('hex');

const ROLE_WEIGHT: Record<Role, number> = {
  VIEWER: 1,
  EDITOR: 2,
  APPROVER: 3,
  ADMIN: 4,
};

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(plain, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  exp: number;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
}

export function signJwt(user: Pick<User, 'id' | 'email' | 'name' | 'role'>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    } satisfies TokenPayload),
  );
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = base64UrlEncode(
      crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest(),
    );
    if (sig !== expected) return null;
    const parsed = JSON.parse(base64UrlDecode(payload)) as TokenPayload;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}

export function sendProblem(
  res: Response,
  status: number,
  title: string,
  detail: string,
  type = 'about:blank',
): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/problem+json')
    .json({
      type,
      title,
      status,
      detail,
      timestamp: new Date().toISOString(),
    });
}

export interface AuthedRequest extends Request {
  user?: PublicUser;
}

export function createAuthMiddleware(getUserById: (id: string) => User | undefined) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : typeof req.query.token === 'string'
        ? req.query.token
        : '';

    if (!token) {
      sendProblem(res, 401, 'Unauthorized', 'Missing Bearer authentication token.');
      return;
    }

    const payload = verifyJwt(token);
    if (!payload) {
      sendProblem(res, 401, 'Invalid Token', 'Authentication token is expired or invalid.');
      return;
    }

    const user = getUserById(payload.sub);
    if (!user || !user.active) {
      sendProblem(res, 401, 'Account Inactive', 'User account is disabled or does not exist.');
      return;
    }

    req.user = toPublicUser(user);
    next();
  };
}

export function requireMinRole(minRole: Role) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendProblem(res, 401, 'Unauthorized', 'Authentication required.');
      return;
    }
    if (ROLE_WEIGHT[req.user.role] < ROLE_WEIGHT[minRole]) {
      sendProblem(
        res,
        403,
        'Forbidden',
        `Role ${req.user.role} lacks required privilege (${minRole} or higher).`,
      );
      return;
    }
    next();
  };
}

export function canReviewApproval(role: Role): boolean {
  return role === 'APPROVER' || role === 'ADMIN';
}
