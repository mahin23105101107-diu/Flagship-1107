/**
 * Browser-Native FlagShip Runtime Engine for Static Hosting (GitHub Pages).
 *
 * Executes the exact same FlagShip Evaluation Engine, MurmurHash3 sticky bucketing,
 * Visitor rule validation, Z-test & Chi-square SRM analytics, Flag Hygiene detector,
 * RBAC enforcement, and Production self-approval guard directly in the browser with
 * localStorage persistence when no Express backend is attached.
 */

import { computeExperimentAnalytics } from '../engine/analytics';
import { defaultEvaluationEngine, EvaluationContextBuilder } from '../engine/evaluation';
import { defaultBucketingStrategy } from '../engine/hashing';
import { detectStaleFlags } from '../engine/hygiene';
import { acceptRuleNode, RuleValidationVisitor } from '../engine/targeting';
import type {
  ChangeRequest,
  Environment,
  Experiment,
  FeatureFlag,
  FlagEnvironmentConfig,
  FlagType,
  FlagVariation,
  Project,
  PublicUser,
  Role,
  ScheduledChange,
  SdkSnapshot,
  User,
  UserSegment,
} from '../types/flagship';
import {
  buildLocalSeedDatabase,
  hashBrowserPassword,
  type LocalFlagShipDatabase,
  randomHex,
} from './localSeed';

const DB_STORAGE_KEY = 'flagship_static_db_v1';

const ROLE_LEVEL: Record<Role, number> = {
  VIEWER: 1,
  EDITOR: 2,
  APPROVER: 3,
  ADMIN: 4,
};

export interface LocalDomainEvent {
  id: string;
  type:
    | 'FLAG_CONFIG_UPDATED'
    | 'KILL_SWITCH_TOGGLED'
    | 'APPROVAL_RESOLVED'
    | 'FLAG_ROLLED_BACK'
    | 'SCHEDULE_EXECUTED';
  summary: string;
  publishedAt: string;
  revision: number;
}

class LocalApiError extends Error {
  status: number;
  title: string;
  constructor(status: number, title: string, detail: string) {
    super(detail);
    this.status = status;
    this.title = title;
  }
}

let cachedDb: LocalFlagShipDatabase | null = null;
let revision = 1;
const bootTime = Date.now();
const recentEvents: LocalDomainEvent[] = [];
const eventListeners = new Set<(ev: LocalDomainEvent) => void>();

export function subscribeLocalEvents(listener: (ev: LocalDomainEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

function publishLocalEvent(type: LocalDomainEvent['type'], summary: string): void {
  revision += 1;
  const ev: LocalDomainEvent = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    summary,
    publishedAt: new Date().toISOString(),
    revision,
  };
  recentEvents.unshift(ev);
  if (recentEvents.length > 30) recentEvents.pop();
  eventListeners.forEach((fn) => {
    try {
      fn(ev);
    } catch {
      // Ignore listener failure
    }
  });
}

function getDb(): LocalFlagShipDatabase {
  if (cachedDb) return cachedDb;
  try {
    const raw = localStorage.getItem(DB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalFlagShipDatabase;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.flags)) {
        cachedDb = parsed;
        return cachedDb;
      }
    }
  } catch {
    // Fallback to clean seed
  }
  cachedDb = buildLocalSeedDatabase();
  persistDb();
  return cachedDb;
}

function persistDb(): void {
  if (!cachedDb) return;
  try {
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(cachedDb));
  } catch {
    // Ignore storage quota errors
  }
}

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _ph, ...pub } = user;
  return pub;
}

function issueLocalToken(user: User): string {
  return `local.${btoa(JSON.stringify({ sub: user.id, role: user.role, iat: Date.now() }))}`;
}

function resolveUserFromAuth(authHeader?: string): PublicUser | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const db = getDb();

  if (token.startsWith('local.')) {
    try {
      const payload = JSON.parse(atob(token.slice(6))) as { sub?: string };
      const u = db.users.find((item) => item.id === payload.sub && item.active);
      return u ? toPublicUser(u) : null;
    } catch {
      return null;
    }
  }
  // Support standard JWT payload if switching from server session
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
      const u = db.users.find((item) => item.id === payload.sub && item.active);
      return u ? toPublicUser(u) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function requireRole(user: PublicUser | null, minRole: Role): PublicUser {
  if (!user) {
    throw new LocalApiError(401, 'Unauthorized', 'Authentication required.');
  }
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minRole]) {
    throw new LocalApiError(403, 'Forbidden', `Role ${minRole} or higher is required for this action.`);
  }
  return user;
}

function recordAudit(actor: PublicUser, action: string, entityType: string, entityId: string, summary: string): void {
  const db = getDb();
  db.auditLogs.unshift({
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    summary,
    timestamp: new Date().toISOString(),
  });
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
}

function applyFlagConfig(
  configId: string,
  patch: Partial<FlagEnvironmentConfig>,
  actor: PublicUser,
  reason: string,
  eventType: LocalDomainEvent['type'] = 'FLAG_CONFIG_UPDATED',
): FlagEnvironmentConfig {
  const db = getDb();
  const idx = db.flagConfigs.findIndex((c) => c.id === configId);
  if (idx === -1) throw new LocalApiError(404, 'Not Found', `Flag configuration ${configId} not found.`);

  const before = structuredClone(db.flagConfigs[idx]);
  const nowIso = new Date().toISOString();
  const nextRollout = patch.rolloutPercentage ?? before.rolloutPercentage;
  const nextEnabled = patch.enabled ?? before.enabled;
  const fullRolloutSince = nextEnabled && nextRollout >= 100 ? before.fullRolloutSince || nowIso : null;

  const after: FlagEnvironmentConfig = {
    ...before,
    ...patch,
    id: before.id,
    flagId: before.flagId,
    environmentId: before.environmentId,
    version: before.version + 1,
    updatedAt: nowIso,
    updatedBy: actor.id,
    fullRolloutSince,
  };

  db.flagConfigs[idx] = after;
  const flag = db.flags.find((f) => f.id === before.flagId);

  db.versions.unshift({
    id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    flagId: before.flagId,
    environmentId: before.environmentId,
    version: after.version,
    authorId: actor.id,
    authorName: actor.name,
    reason: reason || 'Configuration updated',
    beforeSnapshot: before,
    afterSnapshot: structuredClone(after),
    createdAt: nowIso,
  });

  recordAudit(
    actor,
    eventType,
    'FlagEnvironmentConfig',
    after.id,
    `${flag?.key ?? after.flagId} v${after.version}: ${reason}`,
  );

  db.sdkInstances.forEach((inst) => {
    if (inst.environmentId === after.environmentId && inst.status === 'CONNECTED') {
      inst.lastSyncAt = nowIso;
      inst.lastSyncLatencyMs = inst.transport === 'SSE' ? 12 + Math.floor(Math.random() * 14) : 140;
    }
  });

  persistDb();
  publishLocalEvent(eventType, `${flag?.key ?? after.flagId} updated to v${after.version} (${reason})`);
  return after;
}

function processDueSchedules(): void {
  const db = getDb();
  const now = Date.now();
  const due = db.scheduledChanges.filter(
    (s) => s.status === 'SCHEDULED' && Date.parse(s.scheduledFor) <= now,
  );
  for (const sch of due) {
    const cfg = db.flagConfigs.find((c) => c.flagId === sch.flagId && c.environmentId === sch.environmentId);
    if (cfg) {
      const author = db.users.find((u) => u.id === sch.authorId);
      const actor: PublicUser = author
        ? toPublicUser(author)
        : {
            id: sch.authorId,
            email: 'scheduler@flagship.io',
            name: sch.authorName,
            role: 'ADMIN',
            createdAt: sch.createdAt,
            active: true,
          };
      applyFlagConfig(cfg.id, sch.patch, actor, `Scheduled execution: ${sch.reason}`, 'SCHEDULE_EXECUTED');
    }
    sch.status = 'EXECUTED';
    sch.executedAt = new Date().toISOString();
  }
  if (due.length > 0) persistDb();
}

function buildSnapshotForEnv(env: Environment): SdkSnapshot {
  const db = getDb();
  const projectFlags = db.flags.filter((f) => f.projectId === env.projectId && !f.archived);
  const items = projectFlags
    .map((flag) => {
      const config = db.flagConfigs.find((c) => c.flagId === flag.id && c.environmentId === env.id);
      return config ? { flag, config } : null;
    })
    .filter((item): item is { flag: FeatureFlag; config: FlagEnvironmentConfig } => item !== null);

  return {
    environmentId: env.id,
    environmentKey: env.key,
    projectId: env.projectId,
    generatedAt: new Date().toISOString(),
    revision,
    flags: items,
    segments: db.segments.filter((s) => s.projectId === env.projectId),
  };
}

export async function handleLocalApiRequest<T>(
  rawPath: string,
  options: RequestInit = {},
  headers: Record<string, string> = {},
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const url = new URL(`http://flagship.local${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`);
  const pathname = url.pathname;
  const query = url.searchParams;
  const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : {};
  const db = getDb();

  // Public routes
  if (method === 'GET' && pathname === '/health') {
    return {
      status: 'UP',
      readiness: 'READY',
      uptimeSeconds: Math.floor((Date.now() - bootTime) / 1000),
      timestamp: new Date().toISOString(),
      revision,
      components: {
        database: { status: 'UP', engine: 'Browser PersistentStore (GitHub Pages Live Mode)' },
        sseBroadcaster: { status: 'UP', activeStreams: Math.max(1, eventListeners.size) },
        evaluationEngine: { status: 'UP', bucketingAlgorithm: defaultBucketingStrategy.name },
      },
      metrics: {
        heapUsedMb: 12.4,
        rssMb: 48.2,
        totalProjects: db.projects.filter((p) => !p.archived).length,
        totalFlags: db.flags.filter((f) => !f.archived).length,
        connectedSdkInstances: db.sdkInstances.filter((s) => s.status === 'CONNECTED').length,
        pendingApprovals: db.changeRequests.filter((c) => c.status === 'PENDING').length,
        recentEvents,
      },
    } as T;
  }

  if (method === 'GET' && pathname === '/auth/demo-accounts') {
    return {
      accounts: db.users.map((u) => ({ email: u.email, name: u.name, role: u.role })),
    } as T;
  }

  if (method === 'POST' && pathname === '/auth/login') {
    const { email, password } = body;
    if (!email || !password) {
      throw new LocalApiError(400, 'Validation Error', 'Email and password are required.');
    }
    const user = db.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!user || user.passwordHash !== hashBrowserPassword(String(password))) {
      throw new LocalApiError(401, 'Invalid Credentials', 'Incorrect email or password.');
    }
    if (!user.active) {
      throw new LocalApiError(403, 'Account Disabled', 'This user account has been deactivated.');
    }
    return { token: issueLocalToken(user), user: toPublicUser(user) } as T;
  }

  if (method === 'POST' && pathname === '/auth/register') {
    const { email, name, password } = body;
    if (!email || !name || !password || String(password).length < 6) {
      throw new LocalApiError(400, 'Validation Error', 'Name, valid email, and password (min 6 chars) are required.');
    }
    const normalized = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalized)) {
      throw new LocalApiError(409, 'Conflict', 'An account with this email already exists.');
    }
    const newUser: User = {
      id: `usr-${Date.now()}`,
      email: normalized,
      name: String(name).trim(),
      role: 'EDITOR',
      passwordHash: hashBrowserPassword(String(password)),
      createdAt: new Date().toISOString(),
      active: true,
    };
    db.users.push(newUser);
    persistDb();
    return { token: issueLocalToken(newUser), user: toPublicUser(newUser) } as T;
  }

  if (method === 'GET' && pathname === '/sdk/snapshot') {
    const sdkKey = headers['X-FlagShip-SDK-Key'] || headers['x-flagship-sdk-key'] || query.get('sdkKey') || '';
    const envId = query.get('environmentId') || '';
    const env = sdkKey
      ? db.environments.find((e) => e.sdkKey === sdkKey)
      : envId
        ? db.environments.find((e) => e.id === envId)
        : undefined;
    if (!env) {
      throw new LocalApiError(401, 'Invalid SDK Key', 'Provide a valid X-FlagShip-SDK-Key header or environmentId.');
    }
    return buildSnapshotForEnv(env) as T;
  }

  // Authenticated routes
  const user = resolveUserFromAuth(headers.Authorization || headers.authorization);
  if (!user) {
    throw new LocalApiError(401, 'Unauthorized', 'Authentication required.');
  }

  if (method === 'GET' && pathname === '/auth/me') {
    return { user } as T;
  }

  // Dashboard overview
  if (method === 'GET' && pathname === '/dashboard/overview') {
    const activeFlags = db.flags.filter((f) => !f.archived);
    const prodEnvs = new Set(db.environments.filter((e) => e.type === 'PRODUCTION').map((e) => e.id));
    const prodConfigs = db.flagConfigs.filter((c) => prodEnvs.has(c.environmentId));
    const enabledFlags = prodConfigs.filter((c) => c.enabled && !c.killSwitchActive).length;
    const activeRollouts = prodConfigs.filter(
      (c) => c.enabled && !c.killSwitchActive && c.rolloutPercentage > 0 && c.rolloutPercentage < 100,
    ).length;

    const staleFlags = detectStaleFlags(
      db.flags,
      db.flagConfigs,
      db.projects,
      db.environments,
      db.users.map(toPublicUser),
    );

    const rolloutActivity = db.flags
      .filter((f) => !f.archived)
      .slice(0, 6)
      .map((f) => {
        const dev = db.flagConfigs.find((c) => c.flagId === f.id && db.environments.find((e) => e.id === c.environmentId)?.type === 'DEVELOPMENT');
        const stg = db.flagConfigs.find((c) => c.flagId === f.id && db.environments.find((e) => e.id === c.environmentId)?.type === 'STAGING');
        const prod = db.flagConfigs.find((c) => c.flagId === f.id && db.environments.find((e) => e.id === c.environmentId)?.type === 'PRODUCTION');
        return {
          flagKey: f.key,
          flagName: f.name,
          dev: dev?.enabled ? dev.rolloutPercentage : 0,
          staging: stg?.enabled ? stg.rolloutPercentage : 0,
          prod: prod?.enabled && !prod.killSwitchActive ? prod.rolloutPercentage : 0,
        };
      });

    return {
      kpis: {
        totalProjects: db.projects.filter((p) => !p.archived).length,
        totalFlags: activeFlags.length,
        enabledFlags,
        activeRollouts,
        pendingApprovals: db.changeRequests.filter((c) => c.status === 'PENDING').length,
        connectedSdkInstances: db.sdkInstances.filter((s) => s.status === 'CONNECTED').length,
        staleFlagCount: staleFlags.length,
      },
      rolloutActivity,
      recentChanges: db.versions.slice(0, 6).map((v) => {
        const flag = db.flags.find((f) => f.id === v.flagId);
        const env = db.environments.find((e) => e.id === v.environmentId);
        return {
          ...v,
          flagKey: flag?.key ?? v.flagId,
          flagName: flag?.name ?? v.flagId,
          environmentName: env?.name ?? v.environmentId,
        };
      }),
      pendingApprovals: db.changeRequests.filter((c) => c.status === 'PENDING'),
      sdkInstances: db.sdkInstances,
    } as T;
  }

  // Projects
  if (method === 'GET' && pathname === '/projects') {
    const items = db.projects.map((p) => ({
      ...p,
      environmentCount: db.environments.filter((e) => e.projectId === p.id).length,
      flagCount: db.flags.filter((f) => f.projectId === p.id && !f.archived).length,
      memberCount: db.projectMembers.filter((m) => m.projectId === p.id).length,
    }));
    return { items } as T;
  }

  if (method === 'POST' && pathname === '/projects') {
    requireRole(user, 'EDITOR');
    const { key, name, description = '' } = body;
    if (!key || !name) throw new LocalApiError(400, 'Validation Error', 'Project key and name are required.');
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (db.projects.some((p) => p.key === cleanKey)) {
      throw new LocalApiError(409, 'Duplicate Key', `Project key "${cleanKey}" already exists.`);
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: `proj-${Date.now()}`,
      key: cleanKey,
      name: String(name).trim(),
      description: String(description).trim(),
      ownerId: user.id,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    db.projects.push(project);
    const defaultEnvs: Array<{ key: string; name: string; type: Environment['type']; requiresApproval: boolean }> = [
      { key: 'development', name: 'Development', type: 'DEVELOPMENT', requiresApproval: false },
      { key: 'staging', name: 'Staging', type: 'STAGING', requiresApproval: false },
      { key: 'production', name: 'Production', type: 'PRODUCTION', requiresApproval: true },
    ];
    for (const def of defaultEnvs) {
      db.environments.push({
        id: `env-${cleanKey}-${def.key}-${Date.now().toString(36).slice(-3)}`,
        projectId: project.id,
        key: def.key,
        name: def.name,
        type: def.type,
        sdkKey: `fs_${def.key.slice(0, 3)}_${randomHex(6)}`,
        requiresApproval: def.requiresApproval,
        createdAt: now,
      });
    }
    db.projectMembers.push({
      id: `pm-${Date.now()}`,
      projectId: project.id,
      userId: user.id,
      role: user.role,
      assignedAt: now,
    });
    recordAudit(user, 'PROJECT_CREATED', 'Project', project.id, `Created project "${project.name}" with 3 default environments.`);
    persistDb();
    return { project } as T;
  }

  let match = pathname.match(/^\/projects\/([^/]+)$/);
  if (method === 'PATCH' && match) {
    requireRole(user, 'EDITOR');
    const project = db.projects.find((p) => p.id === match![1]);
    if (!project) throw new LocalApiError(404, 'Not Found', 'Project not found.');
    if (typeof body.name === 'string' && body.name.trim()) project.name = body.name.trim();
    if (typeof body.description === 'string') project.description = body.description.trim();
    if (typeof body.archived === 'boolean') project.archived = body.archived;
    project.updatedAt = new Date().toISOString();
    recordAudit(user, 'PROJECT_UPDATED', 'Project', project.id, `Updated project "${project.name}".`);
    persistDb();
    return { project } as T;
  }

  // Environments
  if (method === 'GET' && pathname === '/environments') {
    const projectId = query.get('projectId');
    const items = projectId ? db.environments.filter((e) => e.projectId === projectId) : db.environments;
    return { items } as T;
  }

  if (method === 'POST' && pathname === '/environments') {
    requireRole(user, 'ADMIN');
    const { projectId, key, name, type = 'STAGING', requiresApproval = false } = body;
    if (!projectId || !key || !name) throw new LocalApiError(400, 'Validation Error', 'projectId, key, and name are required.');
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const env: Environment = {
      id: `env-${Date.now()}`,
      projectId: String(projectId),
      key: cleanKey,
      name: String(name).trim(),
      type: type as Environment['type'],
      sdkKey: `fs_${cleanKey.slice(0, 3)}_${randomHex(6)}`,
      requiresApproval: Boolean(requiresApproval),
      createdAt: new Date().toISOString(),
    };
    db.environments.push(env);
    for (const flag of db.flags.filter((f) => f.projectId === env.projectId)) {
      db.flagConfigs.push({
        id: `cfg-${flag.id}-${env.id}`,
        flagId: flag.id,
        environmentId: env.id,
        enabled: false,
        killSwitchActive: false,
        killSwitchVariationId: flag.defaultVariationId,
        defaultVariationId: flag.defaultVariationId,
        rolloutPercentage: 0,
        rolloutVariationId: flag.variations[0].id,
        rolloutWeights: [],
        individualTargets: [],
        targetingRules: [],
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
        lastEvaluatedAt: null,
        fullRolloutSince: null,
      });
    }
    recordAudit(user, 'ENVIRONMENT_CREATED', 'Environment', env.id, `Created environment "${env.name}".`);
    persistDb();
    return { environment: env } as T;
  }

  match = pathname.match(/^\/environments\/([^/]+)$/);
  if (method === 'PATCH' && match) {
    requireRole(user, 'ADMIN');
    const env = db.environments.find((e) => e.id === match![1]);
    if (!env) throw new LocalApiError(404, 'Not Found', 'Environment not found.');
    if (typeof body.requiresApproval === 'boolean') env.requiresApproval = body.requiresApproval;
    if (body.rotateSdkKey === true) env.sdkKey = `fs_${env.key.slice(0, 3)}_${randomHex(6)}`;
    recordAudit(user, 'ENVIRONMENT_UPDATED', 'Environment', env.id, `Updated environment "${env.name}".`);
    persistDb();
    return { environment: env } as T;
  }

  // Flags list & create
  if (method === 'GET' && pathname === '/flags') {
    const projectId = query.get('projectId');
    const environmentId = query.get('environmentId');
    const type = query.get('type');
    const search = query.get('search')?.trim().toLowerCase();
    const includeArchived = query.get('includeArchived') === 'true';
    const page = Math.max(1, Number(query.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize') ?? 25)));

    let list = db.flags.filter((f) => (includeArchived ? true : !f.archived));
    if (projectId && projectId !== 'all') list = list.filter((f) => f.projectId === projectId);
    if (type && type !== 'ALL') list = list.filter((f) => f.type === type);
    if (search) {
      list = list.filter(
        (f) =>
          f.key.toLowerCase().includes(search) ||
          f.name.toLowerCase().includes(search) ||
          f.description.toLowerCase().includes(search) ||
          f.tags.some((t) => t.toLowerCase().includes(search)),
      );
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize).map((flag) => {
      const owner = db.users.find((u) => u.id === flag.ownerId);
      const configs = db.flagConfigs.filter((c) => c.flagId === flag.id);
      const activeConfig = environmentId
        ? configs.find((c) => c.environmentId === environmentId) ?? configs[0]
        : configs[0];
      return { ...flag, ownerName: owner?.name ?? 'Unknown', configs, activeConfig };
    });

    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } as T;
  }

  if (method === 'POST' && pathname === '/flags') {
    requireRole(user, 'EDITOR');
    const { projectId, key, name, description = '', type = 'BOOLEAN', variations, tags = [] } = body;
    if (!projectId || !key || !name) throw new LocalApiError(400, 'Validation Error', 'projectId, key, and name are required.');
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (db.flags.some((f) => f.projectId === projectId && f.key === cleanKey)) {
      throw new LocalApiError(409, 'Duplicate Flag Key', `Flag key "${cleanKey}" already exists in this project.`);
    }
    const flagType = type as FlagType;
    const builtVariations: FlagVariation[] =
      Array.isArray(variations) && variations.length >= 2
        ? variations.map((v: FlagVariation, idx: number) => ({
            id: v.id || `var-${Date.now()}-${idx}`,
            key: String(v.key || `var-${idx}`),
            name: String(v.name || `Variation ${idx + 1}`),
            value: v.value,
          }))
        : flagType === 'BOOLEAN'
          ? [
              { id: `var-${Date.now()}-on`, key: 'on', name: 'Enabled', value: true },
              { id: `var-${Date.now()}-off`, key: 'off', name: 'Disabled', value: false },
            ]
          : flagType === 'NUMBER'
            ? [
                { id: `var-${Date.now()}-1`, key: 'treatment', name: 'Treatment (100)', value: 100 },
                { id: `var-${Date.now()}-2`, key: 'control', name: 'Control (10)', value: 10 },
              ]
            : flagType === 'JSON'
              ? [
                  { id: `var-${Date.now()}-1`, key: 'variant-a', name: 'Variant A', value: { enabled: true } },
                  { id: `var-${Date.now()}-2`, key: 'default', name: 'Default Config', value: { enabled: false } },
                ]
              : [
                  { id: `var-${Date.now()}-1`, key: 'variant-a', name: 'Variant A', value: 'variant-a' },
                  { id: `var-${Date.now()}-2`, key: 'control', name: 'Control', value: 'control' },
                ];

    const defaultVariationId =
      body.defaultVariationId && builtVariations.some((v) => v.id === body.defaultVariationId)
        ? body.defaultVariationId
        : builtVariations[builtVariations.length - 1].id;

    const now = new Date().toISOString();
    const flag: FeatureFlag = {
      id: `flg-${Date.now()}`,
      projectId: String(projectId),
      key: cleanKey,
      name: String(name).trim(),
      description: String(description).trim(),
      type: flagType,
      variations: builtVariations,
      defaultVariationId,
      ownerId: user.id,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    db.flags.unshift(flag);
    for (const env of db.environments.filter((e) => e.projectId === flag.projectId)) {
      db.flagConfigs.push({
        id: `cfg-${flag.id}-${env.id}`,
        flagId: flag.id,
        environmentId: env.id,
        enabled: env.type === 'DEVELOPMENT',
        killSwitchActive: false,
        killSwitchVariationId: defaultVariationId,
        defaultVariationId,
        rolloutPercentage: env.type === 'DEVELOPMENT' ? 100 : 0,
        rolloutVariationId: builtVariations[0].id,
        rolloutWeights: [],
        individualTargets: [],
        targetingRules: [],
        version: 1,
        updatedAt: now,
        updatedBy: user.id,
        lastEvaluatedAt: now,
        fullRolloutSince: env.type === 'DEVELOPMENT' ? now : null,
      });
    }
    recordAudit(user, 'FLAG_CREATED', 'FeatureFlag', flag.id, `Created ${flag.type} flag "${flag.key}".`);
    persistDb();
    return { flag } as T;
  }

  match = pathname.match(/^\/flags\/([^/]+)\/config\/([^/]+)$/);
  if (method === 'PUT' && match) {
    requireRole(user, 'EDITOR');
    const [, flagId, envId] = match;
    const flag = db.flags.find((f) => f.id === flagId);
    const env = db.environments.find((e) => e.id === envId);
    const config = db.flagConfigs.find((c) => c.flagId === flagId && c.environmentId === envId);
    if (!flag || !env || !config) throw new LocalApiError(404, 'Not Found', 'Flag, environment, or configuration not found.');
    const { patch, reason = 'Configuration change' } = body;
    if (!patch || typeof patch !== 'object') throw new LocalApiError(400, 'Validation Error', 'A configuration patch object is required.');

    if (Array.isArray(patch.targetingRules)) {
      const validator = new RuleValidationVisitor();
      const errors: string[] = [];
      for (const r of patch.targetingRules) {
        if (r?.rootGroup) errors.push(...acceptRuleNode(r.rootGroup, validator));
      }
      if (errors.length > 0) throw new LocalApiError(400, 'Invalid Targeting Rule', errors.join('; '));
    }

    if (env.requiresApproval) {
      const proposedConfig: FlagEnvironmentConfig = {
        ...structuredClone(config),
        ...patch,
        id: config.id,
        flagId: config.flagId,
        environmentId: config.environmentId,
        version: config.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      };
      const cr: ChangeRequest = {
        id: `cr-${Date.now()}`,
        flagId: flag.id,
        flagKey: flag.key,
        flagName: flag.name,
        projectId: flag.projectId,
        environmentId: env.id,
        environmentName: env.name,
        authorId: user.id,
        authorName: user.name,
        reason: String(reason),
        status: 'PENDING',
        beforeConfig: structuredClone(config),
        proposedConfig,
        createdAt: new Date().toISOString(),
      };
      db.changeRequests.unshift(cr);
      recordAudit(user, 'CHANGE_REQUEST_CREATED', 'ChangeRequest', cr.id, `Submitted ${env.name} approval request for "${flag.key}": ${reason}`);
      persistDb();
      return { approvalRequired: true, changeRequest: cr, config } as T;
    }

    const updated = applyFlagConfig(config.id, patch, user, String(reason));
    return { approvalRequired: false, config: updated } as T;
  }

  match = pathname.match(/^\/flags\/([^/]+)\/kill-switch\/([^/]+)$/);
  if (method === 'POST' && match) {
    requireRole(user, 'EDITOR');
    const [, flagId, envId] = match;
    const config = db.flagConfigs.find((c) => c.flagId === flagId && c.environmentId === envId);
    if (!config) throw new LocalApiError(404, 'Not Found', 'Flag configuration not found.');
    const active = typeof body.active === 'boolean' ? body.active : !config.killSwitchActive;
    const reason = body.reason || (active ? 'Emergency Kill Switch Activated' : 'Kill Switch Released');
    const updated = applyFlagConfig(config.id, { killSwitchActive: active }, user, String(reason), 'KILL_SWITCH_TOGGLED');
    return { config: updated } as T;
  }

  match = pathname.match(/^\/flags\/([^/]+)\/evaluate$/);
  if (method === 'POST' && match) {
    const flag = db.flags.find((f) => f.id === match![1] || f.key === match![1]);
    if (!flag) throw new LocalApiError(404, 'Not Found', 'Flag not found.');
    const envId = body.environmentId as string | undefined;
    const config = envId
      ? db.flagConfigs.find((c) => c.flagId === flag.id && c.environmentId === envId)
      : db.flagConfigs.find((c) => c.flagId === flag.id);
    if (!config) throw new LocalApiError(404, 'Not Found', 'Flag environment configuration not found.');
    const userKey = String(body.userKey || '').trim();
    if (!userKey) throw new LocalApiError(400, 'Validation Error', 'userKey is required for evaluation.');

    const attrs = body.attributes && typeof body.attributes === 'object' ? body.attributes : {};
    const ctx = EvaluationContextBuilder.create(userKey).withAttributes(attrs).build();
    const segMap = new Map(db.segments.map((s) => [s.id, s]));
    const result = defaultEvaluationEngine.evaluate(flag, config, ctx, segMap);
    config.lastEvaluatedAt = new Date().toISOString();
    persistDb();
    return { result, bucket: defaultBucketingStrategy.computeBucket(flag.key, userKey) } as T;
  }

  match = pathname.match(/^\/flags\/([^/]+)$/);
  if (method === 'GET' && match) {
    const flag = db.flags.find((f) => f.id === match![1] || f.key === match![1]);
    if (!flag) throw new LocalApiError(404, 'Not Found', 'Feature flag not found.');
    const owner = db.users.find((u) => u.id === flag.ownerId);
    return {
      flag: { ...flag, ownerName: owner?.name ?? 'Unknown' },
      configs: db.flagConfigs.filter((c) => c.flagId === flag.id),
      environments: db.environments.filter((e) => e.projectId === flag.projectId),
      versions: db.versions.filter((v) => v.flagId === flag.id),
    } as T;
  }

  if (method === 'PATCH' && match) {
    requireRole(user, 'EDITOR');
    const flag = db.flags.find((f) => f.id === match![1]);
    if (!flag) throw new LocalApiError(404, 'Not Found', 'Feature flag not found.');
    if (typeof body.name === 'string' && body.name.trim()) flag.name = body.name.trim();
    if (typeof body.description === 'string') flag.description = body.description.trim();
    if (typeof body.archived === 'boolean') flag.archived = body.archived;
    if (Array.isArray(body.tags)) flag.tags = body.tags.map(String);
    if (Array.isArray(body.variations) && body.variations.length >= 2) flag.variations = body.variations;
    if (typeof body.defaultVariationId === 'string') flag.defaultVariationId = body.defaultVariationId;
    flag.updatedAt = new Date().toISOString();
    recordAudit(user, flag.archived ? 'FLAG_ARCHIVED' : 'FLAG_UPDATED', 'FeatureFlag', flag.id, `${flag.archived ? 'Archived' : 'Updated'} flag "${flag.key}".`);
    persistDb();
    return { flag } as T;
  }

  // Rollout simulator
  if (method === 'POST' && pathname === '/rollouts/simulate') {
    const { flagKey = 'demo-flag', rolloutPercentage = 25, sampleSize = 5000 } = body;
    const n = Math.min(20000, Math.max(100, Number(sampleSize)));
    const deciles = Array.from({ length: 10 }, (_, idx) => ({
      range: `${idx * 10}–${(idx + 1) * 10}%`,
      inRollout: 0,
      defaultCount: 0,
    }));
    let inRolloutTotal = 0;
    for (let i = 0; i < n; i++) {
      const bucket = defaultBucketingStrategy.computeBucket(String(flagKey), `sim-user-${i}`);
      const decileIdx = Math.min(9, Math.floor(bucket / 10));
      if (bucket < Number(rolloutPercentage)) {
        deciles[decileIdx].inRollout++;
        inRolloutTotal++;
      } else {
        deciles[decileIdx].defaultCount++;
      }
    }
    return {
      flagKey,
      sampleSize: n,
      targetPercentage: Number(rolloutPercentage),
      observedPercentage: Number(((inRolloutTotal / n) * 100).toFixed(2)),
      deciles,
    } as T;
  }

  // Segments
  if (method === 'GET' && pathname === '/segments') {
    const projectId = query.get('projectId');
    const items = projectId && projectId !== 'all' ? db.segments.filter((s) => s.projectId === projectId) : db.segments;
    return { items } as T;
  }

  if (method === 'POST' && pathname === '/segments') {
    requireRole(user, 'EDITOR');
    const { projectId, key, name, description = '', includedUsers = [], excludedUsers = [], rootGroup } = body;
    if (!projectId || !key || !name) throw new LocalApiError(400, 'Validation Error', 'projectId, key, and name are required.');
    const now = new Date().toISOString();
    const segment: UserSegment = {
      id: `seg-${Date.now()}`,
      projectId: String(projectId),
      key: String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      name: String(name).trim(),
      description: String(description).trim(),
      includedUsers: Array.isArray(includedUsers) ? includedUsers.map(String) : [],
      excludedUsers: Array.isArray(excludedUsers) ? excludedUsers.map(String) : [],
      rootGroup: rootGroup || { kind: 'group', id: `sg-${Date.now()}`, logicalOp: 'AND', children: [] },
      createdAt: now,
      updatedAt: now,
    };
    db.segments.unshift(segment);
    recordAudit(user, 'SEGMENT_CREATED', 'UserSegment', segment.id, `Created segment "${segment.name}".`);
    persistDb();
    return { segment } as T;
  }

  match = pathname.match(/^\/segments\/([^/]+)$/);
  if (method === 'PUT' && match) {
    requireRole(user, 'EDITOR');
    const seg = db.segments.find((s) => s.id === match![1]);
    if (!seg) throw new LocalApiError(404, 'Not Found', 'Segment not found.');
    if (typeof body.name === 'string') seg.name = body.name.trim();
    if (typeof body.description === 'string') seg.description = body.description.trim();
    if (Array.isArray(body.includedUsers)) seg.includedUsers = body.includedUsers.map(String);
    if (Array.isArray(body.excludedUsers)) seg.excludedUsers = body.excludedUsers.map(String);
    if (body.rootGroup) seg.rootGroup = body.rootGroup;
    seg.updatedAt = new Date().toISOString();
    recordAudit(user, 'SEGMENT_UPDATED', 'UserSegment', seg.id, `Updated segment "${seg.name}".`);
    persistDb();
    return { segment: seg } as T;
  }

  if (method === 'DELETE' && match) {
    requireRole(user, 'EDITOR');
    const idx = db.segments.findIndex((s) => s.id === match![1]);
    if (idx === -1) throw new LocalApiError(404, 'Not Found', 'Segment not found.');
    const [removed] = db.segments.splice(idx, 1);
    recordAudit(user, 'SEGMENT_DELETED', 'UserSegment', removed.id, `Deleted segment "${removed.name}".`);
    persistDb();
    return { deleted: true } as T;
  }

  // Approvals
  if (method === 'GET' && pathname === '/approvals') {
    const status = query.get('status');
    const items = status && status !== 'ALL' ? db.changeRequests.filter((c) => c.status === status) : db.changeRequests;
    return { items } as T;
  }

  match = pathname.match(/^\/approvals\/([^/]+)\/(approve|reject)$/);
  if (method === 'POST' && match) {
    const [, crId, action] = match;
    if (user.role !== 'APPROVER' && user.role !== 'ADMIN') {
      throw new LocalApiError(403, 'Forbidden', 'Only APPROVER or ADMIN roles can review production changes.');
    }
    const cr = db.changeRequests.find((c) => c.id === crId);
    if (!cr) throw new LocalApiError(404, 'Not Found', 'Change request not found.');
    if (cr.status !== 'PENDING') throw new LocalApiError(409, 'Already Reviewed', `Change request is already ${cr.status}.`);

    if (action === 'approve') {
      if (cr.authorId === user.id) {
        throw new LocalApiError(
          403,
          'Self-Approval Prohibited',
          'Security policy prevents authors from approving their own production change requests. Ask another Approver or Admin to review.',
        );
      }
      const cfg = db.flagConfigs.find((c) => c.flagId === cr.flagId && c.environmentId === cr.environmentId);
      if (!cfg) throw new LocalApiError(404, 'Not Found', 'Target flag configuration no longer exists.');
      const updated = applyFlagConfig(cfg.id, cr.proposedConfig, user, `Approved CR ${cr.id} (${cr.reason})`, 'APPROVAL_RESOLVED');
      cr.status = 'APPROVED';
      cr.reviewerId = user.id;
      cr.reviewerName = user.name;
      cr.reviewComment = String(body.comment || 'Approved for production rollout.');
      cr.reviewedAt = new Date().toISOString();
      persistDb();
      return { changeRequest: cr, config: updated } as T;
    }

    cr.status = 'REJECTED';
    cr.reviewerId = user.id;
    cr.reviewerName = user.name;
    cr.reviewComment = String(body.comment || 'Rejected by reviewer.');
    cr.reviewedAt = new Date().toISOString();
    recordAudit(user, 'APPROVAL_REJECTED', 'ChangeRequest', cr.id, `Rejected CR ${cr.id} for "${cr.flagKey}".`);
    persistDb();
    return { changeRequest: cr } as T;
  }

  // Versions & rollback
  if (method === 'GET' && pathname === '/versions') {
    const flagId = query.get('flagId');
    const environmentId = query.get('environmentId');
    let list = db.versions;
    if (flagId && flagId !== 'all') list = list.filter((v) => v.flagId === flagId);
    if (environmentId && environmentId !== 'all') list = list.filter((v) => v.environmentId === environmentId);
    const items = list.map((v) => {
      const flag = db.flags.find((f) => f.id === v.flagId);
      const env = db.environments.find((e) => e.id === v.environmentId);
      return { ...v, flagKey: flag?.key ?? v.flagId, flagName: flag?.name ?? v.flagId, environmentName: env?.name ?? v.environmentId };
    });
    return { items } as T;
  }

  match = pathname.match(/^\/versions\/([^/]+)\/rollback$/);
  if (method === 'POST' && match) {
    requireRole(user, 'EDITOR');
    const targetVersion = db.versions.find((v) => v.id === match![1]);
    if (!targetVersion) throw new LocalApiError(404, 'Rollback Failed', 'Target version not found.');
    const currentIdx = db.flagConfigs.findIndex(
      (c) => c.flagId === targetVersion.flagId && c.environmentId === targetVersion.environmentId,
    );
    if (currentIdx === -1) throw new LocalApiError(404, 'Rollback Failed', 'Target environment configuration not found.');
    const before = structuredClone(db.flagConfigs[currentIdx]);
    const restored = structuredClone(targetVersion.afterSnapshot);
    const nowIso = new Date().toISOString();
    const after: FlagEnvironmentConfig = {
      ...restored,
      id: before.id,
      version: before.version + 1,
      updatedAt: nowIso,
      updatedBy: user.id,
    };
    db.flagConfigs[currentIdx] = after;
    const flag = db.flags.find((f) => f.id === before.flagId);
    db.versions.unshift({
      id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      flagId: before.flagId,
      environmentId: before.environmentId,
      version: after.version,
      authorId: user.id,
      authorName: user.name,
      reason: String(body.reason || `Rolled back to version v${targetVersion.version}`),
      beforeSnapshot: before,
      afterSnapshot: structuredClone(after),
      createdAt: nowIso,
    });
    recordAudit(user, 'FLAG_ROLLED_BACK', 'FlagEnvironmentConfig', after.id, `Rolled back ${flag?.key ?? after.flagId} to v${targetVersion.version} (now v${after.version})`);
    persistDb();
    publishLocalEvent('FLAG_ROLLED_BACK', `Rolled back ${flag?.key ?? after.flagId} to v${targetVersion.version}`);
    return { config: after } as T;
  }

  // Schedules
  if (method === 'GET' && pathname === '/schedules') {
    processDueSchedules();
    return { items: db.scheduledChanges } as T;
  }

  if (method === 'POST' && pathname === '/schedules') {
    requireRole(user, 'EDITOR');
    const { flagId, environmentId, scheduledFor, reason = 'Scheduled rollout', patch } = body;
    const flag = db.flags.find((f) => f.id === flagId);
    const env = db.environments.find((e) => e.id === environmentId);
    if (!flag || !env || !scheduledFor || !patch) {
      throw new LocalApiError(400, 'Validation Error', 'flagId, environmentId, scheduledFor, and patch are required.');
    }
    const item: ScheduledChange = {
      id: `sch-${Date.now()}`,
      flagId: flag.id,
      flagKey: flag.key,
      environmentId: env.id,
      environmentName: env.name,
      authorId: user.id,
      authorName: user.name,
      reason: String(reason),
      scheduledFor: String(scheduledFor),
      status: 'SCHEDULED',
      patch,
      createdAt: new Date().toISOString(),
    };
    db.scheduledChanges.unshift(item);
    recordAudit(user, 'CHANGE_SCHEDULED', 'ScheduledChange', item.id, `Scheduled change for "${flag.key}" at ${scheduledFor}.`);
    persistDb();
    return { schedule: item } as T;
  }

  match = pathname.match(/^\/schedules\/([^/]+)\/cancel$/);
  if (method === 'POST' && match) {
    requireRole(user, 'EDITOR');
    const item = db.scheduledChanges.find((s) => s.id === match![1]);
    if (!item) throw new LocalApiError(404, 'Not Found', 'Scheduled change not found.');
    item.status = 'CANCELLED';
    persistDb();
    return { schedule: item } as T;
  }

  // Experiments & Analytics
  if (method === 'GET' && pathname === '/experiments') {
    return { items: db.experiments } as T;
  }

  if (method === 'POST' && pathname === '/experiments') {
    requireRole(user, 'EDITOR');
    const { projectId, environmentId, flagId, name, hypothesis = '', metricName = 'conversion' } = body;
    const flag = db.flags.find((f) => f.id === flagId);
    if (!flag || !name || !projectId || !environmentId) {
      throw new LocalApiError(400, 'Validation Error', 'projectId, environmentId, flagId, and name are required.');
    }
    const v0 = flag.variations[0];
    const v1 = flag.variations[1] ?? flag.variations[0];
    const exp: Experiment = {
      id: `exp-${Date.now()}`,
      projectId: String(projectId),
      environmentId: String(environmentId),
      flagId: flag.id,
      flagKey: flag.key,
      name: String(name).trim(),
      hypothesis: String(hypothesis).trim(),
      metricName: String(metricName).trim(),
      controlVariationId: flag.defaultVariationId,
      treatmentVariationId: v0.id === flag.defaultVariationId ? v1.id : v0.id,
      expectedSplit: {
        [flag.defaultVariationId]: 50,
        [v0.id === flag.defaultVariationId ? v1.id : v0.id]: 50,
      },
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
    };
    db.experiments.unshift(exp);
    recordAudit(user, 'EXPERIMENT_CREATED', 'Experiment', exp.id, `Created experiment "${exp.name}".`);
    persistDb();
    return { experiment: exp } as T;
  }

  if (method === 'GET' && pathname === '/analytics/experiments') {
    const items = db.experiments.map((exp) => {
      const flag = db.flags.find((f) => f.id === exp.flagId);
      return computeExperimentAnalytics(exp, flag, db.exposures, db.conversions);
    });
    return { items } as T;
  }

  match = pathname.match(/^\/analytics\/experiments\/([^/]+)\/simulate$/);
  if (method === 'POST' && match) {
    requireRole(user, 'EDITOR');
    const exp = db.experiments.find((e) => e.id === match![1]);
    if (!exp) throw new LocalApiError(404, 'Not Found', 'Experiment not found.');
    const batchSize = Math.min(200, Math.max(10, Number(body.count ?? 40)));
    const now = new Date().toISOString();
    for (let i = 0; i < batchSize; i++) {
      const isTreatment = i % 2 === 0;
      const vid = isTreatment ? exp.treatmentVariationId : exp.controlVariationId;
      const userKey = `sim-${Date.now()}-${i}`;
      db.exposures.push({
        id: `exp-sim-${Date.now()}-${i}`,
        experimentId: exp.id,
        flagKey: exp.flagKey,
        userKey,
        variationId: vid,
        timestamp: now,
      });
      const convProb = isTreatment ? 0.2 : 0.12;
      if ((i * 37) % 100 < convProb * 100) {
        db.conversions.push({
          id: `conv-sim-${Date.now()}-${i}`,
          experimentId: exp.id,
          flagKey: exp.flagKey,
          userKey,
          variationId: vid,
          value: 1,
          timestamp: now,
        });
      }
    }
    persistDb();
    const flag = db.flags.find((f) => f.id === exp.flagId);
    return { summary: computeExperimentAnalytics(exp, flag, db.exposures, db.conversions) } as T;
  }

  // Hygiene
  if (method === 'GET' && pathname === '/hygiene') {
    return {
      items: detectStaleFlags(db.flags, db.flagConfigs, db.projects, db.environments, db.users.map(toPublicUser)),
    } as T;
  }

  // Users
  if (method === 'GET' && pathname === '/users') {
    return { items: db.users.map(toPublicUser), memberships: db.projectMembers } as T;
  }

  if (method === 'POST' && pathname === '/users') {
    requireRole(user, 'ADMIN');
    const { email, name, role = 'VIEWER', password = 'flagship123' } = body;
    if (!email || !name) throw new LocalApiError(400, 'Validation Error', 'Email and name are required.');
    const normalized = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalized)) {
      throw new LocalApiError(409, 'Conflict', 'User with this email already exists.');
    }
    const created: User = {
      id: `usr-${Date.now()}`,
      email: normalized,
      name: String(name).trim(),
      role: role as Role,
      passwordHash: hashBrowserPassword(String(password)),
      createdAt: new Date().toISOString(),
      active: true,
    };
    db.users.push(created);
    recordAudit(user, 'USER_INVITED', 'User', created.id, `Added team member ${created.name} (${created.role}).`);
    persistDb();
    return { user: toPublicUser(created) } as T;
  }

  match = pathname.match(/^\/users\/([^/]+)$/);
  if (method === 'PATCH' && match) {
    requireRole(user, 'ADMIN');
    const target = db.users.find((u) => u.id === match![1]);
    if (!target) throw new LocalApiError(404, 'Not Found', 'User not found.');
    const validRoles: Role[] = ['VIEWER', 'EDITOR', 'APPROVER', 'ADMIN'];
    if (body.role && validRoles.includes(body.role)) target.role = body.role;
    if (typeof body.active === 'boolean') target.active = body.active;
    recordAudit(user, 'USER_ROLE_UPDATED', 'User', target.id, `Updated ${target.email} role to ${target.role}.`);
    persistDb();
    return { user: toPublicUser(target) } as T;
  }

  // SDK instances & Audit
  if (method === 'GET' && pathname === '/sdk/instances') {
    return { items: db.sdkInstances } as T;
  }

  if (method === 'GET' && pathname === '/audit') {
    const page = Math.max(1, Number(query.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize') ?? 25)));
    const total = db.auditLogs.length;
    const start = (page - 1) * pageSize;
    return { items: db.auditLogs.slice(start, start + pageSize), total, page, pageSize } as T;
  }

  // Settings reset
  if (method === 'POST' && pathname === '/settings/reset-demo') {
    requireRole(user, 'ADMIN');
    cachedDb = buildLocalSeedDatabase();
    persistDb();
    publishLocalEvent('FLAG_CONFIG_UPDATED', 'Demo dataset reset to clean baseline');
    return { reset: true } as T;
  }

  throw new LocalApiError(404, 'Not Found', `Endpoint ${method} ${pathname} not found.`);
}

/** Custom fetch adapter for FlagShipClient offline simulator when hosted on GitHub Pages */
export const localSdkFetch: typeof fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(urlStr, 'http://flagship.local');
  const apiPath = parsed.pathname.replace(/^\/api\/v1/, '') + parsed.search;
  const headerObj: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headerObj[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headerObj[k] = v;
    } else {
      Object.assign(headerObj, init.headers);
    }
  }
  try {
    const data = await handleLocalApiRequest(apiPath, init, headerObj);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const status = err instanceof LocalApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Local SDK request failed';
    return new Response(JSON.stringify({ status, detail: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
