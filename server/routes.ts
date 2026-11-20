import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { computeExperimentAnalytics } from '../src/engine/analytics';
import { defaultEvaluationEngine, EvaluationContextBuilder } from '../src/engine/evaluation';
import { defaultBucketingStrategy } from '../src/engine/hashing';
import { detectStaleFlags } from '../src/engine/hygiene';
import { acceptRuleNode, RuleValidationVisitor } from '../src/engine/targeting';
import type {
  ChangeRequest,
  Environment,
  Experiment,
  FeatureFlag,
  FlagEnvironmentConfig,
  FlagType,
  FlagVariation,
  Project,
  Role,
  ScheduledChange,
  SdkInstance,
  SdkSnapshot,
  UserSegment,
} from '../src/types/flagship';
import {
  type AuthedRequest,
  canReviewApproval,
  createAuthMiddleware,
  hashPassword,
  requireMinRole,
  sendProblem,
  signJwt,
  toPublicUser,
  verifyPassword,
} from './auth';
import { ApplyFlagConfigCommand, RollbackFlagConfigCommand } from './commands';
import { eventBus } from './eventBus';
import { store } from './store';

export function buildApiRouter(): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware((id) => store.state.users.find((u) => u.id === id));

  const recordAudit = (
    req: AuthedRequest,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
  ) => {
    if (!req.user) return;
    store.state.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action,
      entityType,
      entityId,
      summary,
      timestamp: new Date().toISOString(),
    });
    if (store.state.auditLogs.length > 500) {
      store.state.auditLogs = store.state.auditLogs.slice(0, 500);
    }
  };

  // Helper: execute due scheduled changes
  const processDueSchedules = () => {
    const now = Date.now();
    const due = store.state.scheduledChanges.filter(
      (s) => s.status === 'SCHEDULED' && Date.parse(s.scheduledFor) <= now,
    );
    for (const sch of due) {
      const cfg = store.state.flagConfigs.find(
        (c) => c.flagId === sch.flagId && c.environmentId === sch.environmentId,
      );
      if (cfg) {
        const author = store.state.users.find((u) => u.id === sch.authorId);
        const actor = author
          ? toPublicUser(author)
          : {
              id: sch.authorId,
              email: 'scheduler@flagship.io',
              name: sch.authorName,
              role: 'ADMIN' as Role,
              createdAt: sch.createdAt,
              active: true,
            };
        new ApplyFlagConfigCommand(
          cfg.id,
          sch.patch,
          actor,
          `Scheduled execution: ${sch.reason}`,
          'SCHEDULE_EXECUTED',
        ).execute();
      }
      sch.status = 'EXECUTED';
      sch.executedAt = new Date().toISOString();
    }
    if (due.length > 0) store.save();
  };

  // Run schedule check every 15 seconds
  const scheduleTimer = setInterval(processDueSchedules, 15_000);
  scheduleTimer.unref();

  // =========================================================================
  // OPENAPI 3.1 SPECIFICATION & ACTUATOR HEALTH (PUBLIC / MONITORING)
  // =========================================================================
  router.get('/openapi.json', (_req, res) => {
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'FlagShip Platform REST API',
        version: '1.0.0',
        description:
          'Self-hosted Feature Flag and Gradual Rollout Platform API with deterministic targeting, SSE live push, approvals, and experiment analytics.',
      },
      servers: [{ url: '/api/v1' }],
      paths: {
        '/auth/login': { post: { summary: 'Authenticate user and issue JWT' } },
        '/projects': { get: { summary: 'List projects' }, post: { summary: 'Create project' } },
        '/environments': { get: { summary: 'List environments' }, post: { summary: 'Create environment' } },
        '/flags': { get: { summary: 'List feature flags (paginated)' }, post: { summary: 'Create feature flag' } },
        '/flags/{flagId}/config/{envId}': { put: { summary: 'Update environment flag config or submit Prod approval' } },
        '/flags/{flagId}/kill-switch/{envId}': { post: { summary: 'Instant kill-switch toggle (bypasses approval for incident response)' } },
        '/flags/{flagId}/evaluate': { post: { summary: 'Deterministic evaluation preview' } },
        '/segments': { get: { summary: 'List user segments' }, post: { summary: 'Create segment' } },
        '/approvals': { get: { summary: 'List change requests' } },
        '/approvals/{id}/approve': { post: { summary: 'Approve production change (self-approval blocked)' } },
        '/approvals/{id}/reject': { post: { summary: 'Reject production change' } },
        '/versions': { get: { summary: 'List configuration version history' } },
        '/versions/{id}/rollback': { post: { summary: 'Rollback flag environment to prior version' } },
        '/experiments': { get: { summary: 'List experiments' }, post: { summary: 'Create experiment' } },
        '/analytics/experiments': { get: { summary: 'Experiment analytics with z-test and Chi-square SRM' } },
        '/events/batch': { post: { summary: 'Ingest batched SDK exposure and conversion events' } },
        '/sdk/snapshot': { get: { summary: 'Download full environment snapshot for SDK local evaluation' } },
        '/sdk/stream': { get: { summary: 'Server-Sent Events (SSE) live update stream' } },
        '/hygiene': { get: { summary: 'Detect stale flags (>30d unevaluated or >=14d at 100%)' } },
        '/audit': { get: { summary: 'Paginated audit log' } },
        '/health': { get: { summary: 'Actuator-style health, readiness, and metrics' } },
      },
    });
  });

  router.get('/health', (_req, res) => {
    const mem = process.memoryUsage();
    const db = store.state;
    res.json({
      status: 'UP',
      readiness: 'READY',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      revision: eventBus.getRevision(),
      components: {
        database: { status: 'UP', engine: 'PersistentStore / PostgreSQL-Compatible Schema' },
        sseBroadcaster: {
          status: 'UP',
          activeStreams: eventBus.getSubscriberCount(),
        },
        evaluationEngine: {
          status: 'UP',
          bucketingAlgorithm: defaultBucketingStrategy.name,
        },
      },
      metrics: {
        heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
        rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
        totalProjects: db.projects.filter((p) => !p.archived).length,
        totalFlags: db.flags.filter((f) => !f.archived).length,
        connectedSdkInstances: db.sdkInstances.filter((s) => s.status === 'CONNECTED').length,
        pendingApprovals: db.changeRequests.filter((c) => c.status === 'PENDING').length,
        recentEvents: eventBus.getRecentEvents(),
      },
    });
  });

  // =========================================================================
  // AUTHENTICATION (/api/v1/auth)
  // =========================================================================
  router.get('/auth/demo-accounts', (_req, res) => {
    res.json({
      accounts: store.state.users.map((u) => ({
        email: u.email,
        name: u.name,
        role: u.role,
      })),
    });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      sendProblem(res, 400, 'Validation Error', 'Email and password are required.');
      return;
    }

    const user = store.state.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendProblem(res, 401, 'Invalid Credentials', 'Incorrect email or password.');
      return;
    }
    if (!user.active) {
      sendProblem(res, 403, 'Account Disabled', 'This user account has been deactivated.');
      return;
    }

    const token = signJwt(user);
    res.json({ token, user: toPublicUser(user) });
  });

  router.post('/auth/register', (req: Request, res: Response) => {
    const { email, name, password } = req.body ?? {};
    if (!email || !name || !password || String(password).length < 6) {
      sendProblem(
        res,
        400,
        'Validation Error',
        'Name, valid email, and password (min 6 chars) are required.',
      );
      return;
    }
    const normalized = String(email).trim().toLowerCase();
    if (store.state.users.some((u) => u.email.toLowerCase() === normalized)) {
      sendProblem(res, 409, 'Conflict', 'An account with this email already exists.');
      return;
    }

    const newUser = {
      id: `usr-${Date.now()}`,
      email: normalized,
      name: String(name).trim(),
      role: 'EDITOR' as Role,
      passwordHash: hashPassword(String(password)),
      createdAt: new Date().toISOString(),
      active: true,
    };
    store.state.users.push(newUser);
    store.save();
    const token = signJwt(newUser);
    res.status(201).json({ token, user: toPublicUser(newUser) });
  });

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  // =========================================================================
  // SDK PUBLIC / SDK-KEY ENDPOINTS (/api/v1/sdk & /api/v1/events)
  // =========================================================================
  const buildSnapshotForEnv = (env: Environment): SdkSnapshot => {
    const db = store.state;
    const projectFlags = db.flags.filter((f) => f.projectId === env.projectId && !f.archived);
    const items = projectFlags
      .map((flag) => {
        const config = db.flagConfigs.find(
          (c) => c.flagId === flag.id && c.environmentId === env.id,
        );
        return config ? { flag, config } : null;
      })
      .filter((item): item is { flag: FeatureFlag; config: FlagEnvironmentConfig } => item !== null);

    return {
      environmentId: env.id,
      environmentKey: env.key,
      projectId: env.projectId,
      generatedAt: new Date().toISOString(),
      revision: eventBus.getRevision(),
      flags: items,
      segments: db.segments.filter((s) => s.projectId === env.projectId),
    };
  };

  router.get('/sdk/snapshot', (req: Request, res: Response) => {
    const sdkKey = (req.headers['x-flagship-sdk-key'] as string) || (req.query.sdkKey as string);
    const envId = req.query.environmentId as string | undefined;

    const env = sdkKey
      ? store.state.environments.find((e) => e.sdkKey === sdkKey)
      : envId
        ? store.state.environments.find((e) => e.id === envId)
        : undefined;

    if (!env) {
      sendProblem(res, 401, 'Invalid SDK Key', 'Provide a valid X-FlagShip-SDK-Key header or environmentId.');
      return;
    }

    res.json(buildSnapshotForEnv(env));
  });

  // FR5: Server-Sent Events (SSE) live stream
  router.get('/sdk/stream', (req: Request, res: Response) => {
    const sdkKey = (req.headers['x-flagship-sdk-key'] as string) || (req.query.sdkKey as string);
    const scope = req.query.scope as string | undefined;
    let envId: string | undefined;

    if (sdkKey) {
      const env = store.state.environments.find((e) => e.sdkKey === sdkKey);
      if (!env) {
        sendProblem(res, 401, 'Invalid SDK Key', 'Unknown SDK key for SSE stream.');
        return;
      }
      envId = env.id;
    } else if (scope !== 'dashboard') {
      sendProblem(res, 401, 'Unauthorized Stream', 'Provide sdkKey or scope=dashboard.');
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const subId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const clientName = (req.query.instanceName as string) || (scope === 'dashboard' ? 'admin-dashboard' : 'spring-sdk');

    eventBus.addSubscriber({
      id: subId,
      res,
      environmentId: envId,
      clientName,
      connectedAt: new Date().toISOString(),
    });

    res.write(
      `event: CONNECTED\ndata: ${JSON.stringify({
        subscriberId: subId,
        revision: eventBus.getRevision(),
        connectedAt: new Date().toISOString(),
      })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(
          `event: HEARTBEAT\ndata: ${JSON.stringify({
            revision: eventBus.getRevision(),
            ts: new Date().toISOString(),
          })}\n\n`,
        );
      } catch {
        clearInterval(heartbeat);
        eventBus.removeSubscriber(subId);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      eventBus.removeSubscriber(subId);
    });
  });

  router.post('/sdk/heartbeat', (req: Request, res: Response) => {
    const sdkKey = (req.headers['x-flagship-sdk-key'] as string) || req.body?.sdkKey;
    const env = store.state.environments.find((e) => e.sdkKey === sdkKey);
    if (!env) {
      sendProblem(res, 401, 'Invalid SDK Key', 'Unknown SDK key.');
      return;
    }
    const instanceName = String(req.body?.instanceName || `sdk-${Date.now()}`);
    const transport = req.body?.transport === 'POLLING' ? 'POLLING' : 'SSE';
    const sdkVersion = String(req.body?.sdkVersion || 'flagship-spring-boot-starter:1.0.0');
    const now = new Date().toISOString();

    let inst = store.state.sdkInstances.find(
      (i) => i.instanceName === instanceName && i.environmentId === env.id,
    );
    if (inst) {
      inst.lastSyncAt = now;
      inst.status = 'CONNECTED';
      inst.transport = transport;
      inst.lastSyncLatencyMs = Number(req.body?.latencyMs ?? 15);
    } else {
      inst = {
        id: `sdk-${Date.now()}`,
        instanceName,
        sdkKey: env.sdkKey,
        environmentId: env.id,
        projectId: env.projectId,
        sdkVersion,
        transport,
        status: 'CONNECTED',
        lastSyncAt: now,
        lastSyncLatencyMs: Number(req.body?.latencyMs ?? 15),
        connectedAt: now,
      };
      store.state.sdkInstances.unshift(inst);
    }
    store.save();
    res.json({ instance: inst, revision: eventBus.getRevision() });
  });

  // FR8: Batched SDK exposure & conversion event ingestion
  router.post('/events/batch', (req: Request, res: Response) => {
    const { exposures = [], conversions = [] } = req.body ?? {};
    const now = new Date().toISOString();
    let addedExposures = 0;
    let addedConversions = 0;

    if (Array.isArray(exposures)) {
      for (const e of exposures) {
        if (!e?.experimentId || !e?.userKey || !e?.variationId) continue;
        store.state.exposures.push({
          id: `exp-ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          experimentId: String(e.experimentId),
          flagKey: String(e.flagKey || ''),
          userKey: String(e.userKey),
          variationId: String(e.variationId),
          timestamp: e.timestamp || now,
        });
        addedExposures++;
      }
    }

    if (Array.isArray(conversions)) {
      for (const c of conversions) {
        if (!c?.experimentId || !c?.userKey || !c?.variationId) continue;
        store.state.conversions.push({
          id: `conv-ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          experimentId: String(c.experimentId),
          flagKey: String(c.flagKey || ''),
          userKey: String(c.userKey),
          variationId: String(c.variationId),
          value: Number(c.value ?? 1),
          timestamp: c.timestamp || now,
        });
        addedConversions++;
      }
    }

    store.save();
    res.status(202).json({ acceptedExposures: addedExposures, acceptedConversions: addedConversions });
  });

  // =========================================================================
  // AUTHENTICATED ADMIN DASHBOARD ROUTES
  // =========================================================================
  router.use(requireAuth);

  // Dashboard summary overview
  router.get('/dashboard/overview', (_req, res) => {
    const db = store.state;
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

    res.json({
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
    });
  });

  // =========================================================================
  // PROJECTS (/api/v1/projects)
  // =========================================================================
  router.get('/projects', (_req, res) => {
    const db = store.state;
    const enriched = db.projects.map((p) => ({
      ...p,
      environmentCount: db.environments.filter((e) => e.projectId === p.id).length,
      flagCount: db.flags.filter((f) => f.projectId === p.id && !f.archived).length,
      memberCount: db.projectMembers.filter((m) => m.projectId === p.id).length,
    }));
    res.json({ items: enriched });
  });

  router.post('/projects', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const { key, name, description = '' } = req.body ?? {};
    if (!key || !name) {
      sendProblem(res, 400, 'Validation Error', 'Project key and name are required.');
      return;
    }
    const cleanKey = String(key)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');
    if (store.state.projects.some((p) => p.key === cleanKey)) {
      sendProblem(res, 409, 'Duplicate Key', `Project key "${cleanKey}" already exists.`);
      return;
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: `proj-${Date.now()}`,
      key: cleanKey,
      name: String(name).trim(),
      description: String(description).trim(),
      ownerId: req.user!.id,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    store.state.projects.push(project);

    // Auto-provision standard Development, Staging, Production environments (FR1)
    const defaultEnvs: Array<{ key: string; name: string; type: Environment['type']; requiresApproval: boolean }> = [
      { key: 'development', name: 'Development', type: 'DEVELOPMENT', requiresApproval: false },
      { key: 'staging', name: 'Staging', type: 'STAGING', requiresApproval: false },
      { key: 'production', name: 'Production', type: 'PRODUCTION', requiresApproval: true },
    ];
    for (const def of defaultEnvs) {
      store.state.environments.push({
        id: `env-${cleanKey}-${def.key}-${Date.now().toString(36).slice(-3)}`,
        projectId: project.id,
        key: def.key,
        name: def.name,
        type: def.type,
        sdkKey: `fs_${def.key.slice(0, 3)}_${crypto.randomBytes(6).toString('hex')}`,
        requiresApproval: def.requiresApproval,
        createdAt: now,
      });
    }

    store.state.projectMembers.push({
      id: `pm-${Date.now()}`,
      projectId: project.id,
      userId: req.user!.id,
      role: req.user!.role,
      assignedAt: now,
    });

    recordAudit(req, 'PROJECT_CREATED', 'Project', project.id, `Created project "${project.name}" with 3 default environments.`);
    store.save();
    res.status(201).json({ project });
  });

  router.patch('/projects/:projectId', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const project = store.state.projects.find((p) => p.id === req.params.projectId);
    if (!project) {
      sendProblem(res, 404, 'Not Found', 'Project not found.');
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) project.name = req.body.name.trim();
    if (typeof req.body?.description === 'string') project.description = req.body.description.trim();
    if (typeof req.body?.archived === 'boolean') project.archived = req.body.archived;
    project.updatedAt = new Date().toISOString();
    recordAudit(req, 'PROJECT_UPDATED', 'Project', project.id, `Updated project "${project.name}".`);
    store.save();
    res.json({ project });
  });

  // =========================================================================
  // ENVIRONMENTS (/api/v1/environments)
  // =========================================================================
  router.get('/environments', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    const envs = projectId
      ? store.state.environments.filter((e) => e.projectId === projectId)
      : store.state.environments;
    res.json({ items: envs });
  });

  router.post('/environments', requireMinRole('ADMIN'), (req: AuthedRequest, res: Response) => {
    const { projectId, key, name, type = 'STAGING', requiresApproval = false } = req.body ?? {};
    if (!projectId || !key || !name) {
      sendProblem(res, 400, 'Validation Error', 'projectId, key, and name are required.');
      return;
    }
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const env: Environment = {
      id: `env-${Date.now()}`,
      projectId: String(projectId),
      key: cleanKey,
      name: String(name).trim(),
      type: type as Environment['type'],
      sdkKey: `fs_${cleanKey.slice(0, 3)}_${crypto.randomBytes(6).toString('hex')}`,
      requiresApproval: Boolean(requiresApproval),
      createdAt: new Date().toISOString(),
    };
    store.state.environments.push(env);

    // Initialize configs for existing project flags
    const projectFlags = store.state.flags.filter((f) => f.projectId === env.projectId);
    for (const flag of projectFlags) {
      store.state.flagConfigs.push({
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
        updatedBy: req.user!.id,
        lastEvaluatedAt: null,
        fullRolloutSince: null,
      });
    }

    recordAudit(req, 'ENVIRONMENT_CREATED', 'Environment', env.id, `Created environment "${env.name}".`);
    store.save();
    res.status(201).json({ environment: env });
  });

  router.patch('/environments/:envId', requireMinRole('ADMIN'), (req: AuthedRequest, res: Response) => {
    const env = store.state.environments.find((e) => e.id === req.params.envId);
    if (!env) {
      sendProblem(res, 404, 'Not Found', 'Environment not found.');
      return;
    }
    if (typeof req.body?.requiresApproval === 'boolean') {
      env.requiresApproval = req.body.requiresApproval;
    }
    if (req.body?.rotateSdkKey === true) {
      env.sdkKey = `fs_${env.key.slice(0, 3)}_${crypto.randomBytes(6).toString('hex')}`;
    }
    recordAudit(req, 'ENVIRONMENT_UPDATED', 'Environment', env.id, `Updated environment "${env.name}".`);
    store.save();
    res.json({ environment: env });
  });

  // =========================================================================
  // FEATURE FLAGS (/api/v1/flags)
  // =========================================================================
  router.get('/flags', (req: Request, res: Response) => {
    const db = store.state;
    const projectId = req.query.projectId as string | undefined;
    const environmentId = req.query.environmentId as string | undefined;
    const type = req.query.type as string | undefined;
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const includeArchived = req.query.includeArchived === 'true';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));

    let list = db.flags.filter((f) => (includeArchived ? true : !f.archived));
    if (projectId && projectId !== 'all') {
      list = list.filter((f) => f.projectId === projectId);
    }
    if (type && type !== 'ALL') {
      list = list.filter((f) => f.type === type);
    }
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
    const slice = list.slice(start, start + pageSize);

    const items = slice.map((flag) => {
      const owner = db.users.find((u) => u.id === flag.ownerId);
      const configs = db.flagConfigs.filter((c) => c.flagId === flag.id);
      const activeConfig = environmentId
        ? configs.find((c) => c.environmentId === environmentId) ?? configs[0]
        : configs[0];
      return {
        ...flag,
        ownerName: owner?.name ?? 'Unknown',
        configs,
        activeConfig,
      };
    });

    res.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  router.get('/flags/:flagId', (req: Request, res: Response) => {
    const db = store.state;
    const flag = db.flags.find((f) => f.id === req.params.flagId || f.key === req.params.flagId);
    if (!flag) {
      sendProblem(res, 404, 'Not Found', 'Feature flag not found.');
      return;
    }
    const owner = db.users.find((u) => u.id === flag.ownerId);
    const configs = db.flagConfigs.filter((c) => c.flagId === flag.id);
    const environments = db.environments.filter((e) => e.projectId === flag.projectId);
    const versions = db.versions.filter((v) => v.flagId === flag.id);
    res.json({
      flag: { ...flag, ownerName: owner?.name ?? 'Unknown' },
      configs,
      environments,
      versions,
    });
  });

  router.post('/flags', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const { projectId, key, name, description = '', type = 'BOOLEAN', variations, tags = [] } = req.body ?? {};
    if (!projectId || !key || !name) {
      sendProblem(res, 400, 'Validation Error', 'projectId, key, and name are required.');
      return;
    }
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (store.state.flags.some((f) => f.projectId === projectId && f.key === cleanKey)) {
      sendProblem(res, 409, 'Duplicate Flag Key', `Flag key "${cleanKey}" already exists in this project.`);
      return;
    }

    const flagType = type as FlagType;
    const builtVariations: FlagVariation[] =
      Array.isArray(variations) && variations.length >= 2
        ? variations.map((v, idx) => ({
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
      req.body?.defaultVariationId && builtVariations.some((v) => v.id === req.body.defaultVariationId)
        ? req.body.defaultVariationId
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
      ownerId: req.user!.id,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    store.state.flags.unshift(flag);

    const projectEnvs = store.state.environments.filter((e) => e.projectId === flag.projectId);
    for (const env of projectEnvs) {
      store.state.flagConfigs.push({
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
        updatedBy: req.user!.id,
        lastEvaluatedAt: now,
        fullRolloutSince: env.type === 'DEVELOPMENT' ? now : null,
      });
    }

    recordAudit(req, 'FLAG_CREATED', 'FeatureFlag', flag.id, `Created ${flag.type} flag "${flag.key}".`);
    store.save();
    res.status(201).json({ flag });
  });

  router.patch('/flags/:flagId', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const flag = store.state.flags.find((f) => f.id === req.params.flagId);
    if (!flag) {
      sendProblem(res, 404, 'Not Found', 'Feature flag not found.');
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) flag.name = req.body.name.trim();
    if (typeof req.body?.description === 'string') flag.description = req.body.description.trim();
    if (typeof req.body?.archived === 'boolean') flag.archived = req.body.archived;
    if (Array.isArray(req.body?.tags)) flag.tags = req.body.tags.map(String);
    if (Array.isArray(req.body?.variations) && req.body.variations.length >= 2) {
      flag.variations = req.body.variations;
    }
    if (typeof req.body?.defaultVariationId === 'string') {
      flag.defaultVariationId = req.body.defaultVariationId;
    }
    flag.updatedAt = new Date().toISOString();

    recordAudit(
      req,
      flag.archived ? 'FLAG_ARCHIVED' : 'FLAG_UPDATED',
      'FeatureFlag',
      flag.id,
      `${flag.archived ? 'Archived' : 'Updated'} flag "${flag.key}".`,
    );
    store.save();
    res.json({ flag });
  });

  // Update environment config (intercepts into ChangeRequest if env.requiresApproval is true!)
  router.put('/flags/:flagId/config/:envId', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const flag = store.state.flags.find((f) => f.id === req.params.flagId);
    const env = store.state.environments.find((e) => e.id === req.params.envId);
    const config = store.state.flagConfigs.find(
      (c) => c.flagId === req.params.flagId && c.environmentId === req.params.envId,
    );
    if (!flag || !env || !config) {
      sendProblem(res, 404, 'Not Found', 'Flag, environment, or configuration not found.');
      return;
    }

    const { patch, reason = 'Configuration change' } = req.body ?? {};
    if (!patch || typeof patch !== 'object') {
      sendProblem(res, 400, 'Validation Error', 'A configuration patch object is required.');
      return;
    }

    // Validate targeting rule tree via Visitor pattern if provided
    if (Array.isArray(patch.targetingRules)) {
      const validator = new RuleValidationVisitor();
      const errors: string[] = [];
      for (const r of patch.targetingRules) {
        if (r?.rootGroup) {
          errors.push(...acceptRuleNode(r.rootGroup, validator));
        }
      }
      if (errors.length > 0) {
        sendProblem(res, 400, 'Invalid Targeting Rule', errors.join('; '));
        return;
      }
    }

    // FR7: Production changes requiring approval MUST NOT become active before approval
    if (env.requiresApproval) {
      const proposedConfig: FlagEnvironmentConfig = {
        ...structuredClone(config),
        ...patch,
        id: config.id,
        flagId: config.flagId,
        environmentId: config.environmentId,
        version: config.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user!.id,
      };

      const cr: ChangeRequest = {
        id: `cr-${Date.now()}`,
        flagId: flag.id,
        flagKey: flag.key,
        flagName: flag.name,
        projectId: flag.projectId,
        environmentId: env.id,
        environmentName: env.name,
        authorId: req.user!.id,
        authorName: req.user!.name,
        reason: String(reason),
        status: 'PENDING',
        beforeConfig: structuredClone(config),
        proposedConfig,
        createdAt: new Date().toISOString(),
      };
      store.state.changeRequests.unshift(cr);
      recordAudit(
        req,
        'CHANGE_REQUEST_CREATED',
        'ChangeRequest',
        cr.id,
        `Submitted ${env.name} approval request for "${flag.key}": ${reason}`,
      );
      store.save();
      res.status(202).json({
        approvalRequired: true,
        changeRequest: cr,
        config,
      });
      return;
    }

    // Apply immediately in non-protected environments via Command Pattern
    const updated = new ApplyFlagConfigCommand(config.id, patch, req.user!, String(reason)).execute();
    res.json({ approvalRequired: false, config: updated });
  });

  // FR2/FR5/QA3: Emergency Kill Switch (instant propagation, bypasses approval for incident mitigation)
  router.post('/flags/:flagId/kill-switch/:envId', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const config = store.state.flagConfigs.find(
      (c) => c.flagId === req.params.flagId && c.environmentId === req.params.envId,
    );
    if (!config) {
      sendProblem(res, 404, 'Not Found', 'Flag configuration not found.');
      return;
    }
    const active = typeof req.body?.active === 'boolean' ? req.body.active : !config.killSwitchActive;
    const reason =
      req.body?.reason || (active ? 'Emergency Kill Switch Activated' : 'Kill Switch Released');
    const updated = new ApplyFlagConfigCommand(
      config.id,
      { killSwitchActive: active },
      req.user!,
      String(reason),
      'KILL_SWITCH_TOGGLED',
    ).execute();
    res.json({ config: updated });
  });

  // Evaluation Preview (uses exact same deterministic engine as SDK)
  router.post('/flags/:flagId/evaluate', (req: Request, res: Response) => {
    const db = store.state;
    const flag = db.flags.find((f) => f.id === req.params.flagId || f.key === req.params.flagId);
    if (!flag) {
      sendProblem(res, 404, 'Not Found', 'Flag not found.');
      return;
    }
    const envId = req.body?.environmentId as string | undefined;
    const config = envId
      ? db.flagConfigs.find((c) => c.flagId === flag.id && c.environmentId === envId)
      : db.flagConfigs.find((c) => c.flagId === flag.id);

    if (!config) {
      sendProblem(res, 404, 'Not Found', 'Flag environment configuration not found.');
      return;
    }

    const userKey = String(req.body?.userKey || '').trim();
    if (!userKey) {
      sendProblem(res, 400, 'Validation Error', 'userKey is required for evaluation.');
      return;
    }

    const attrs =
      req.body?.attributes && typeof req.body.attributes === 'object' ? req.body.attributes : {};
    const ctx = EvaluationContextBuilder.create(userKey).withAttributes(attrs).build();
    const segMap = new Map(db.segments.map((s) => [s.id, s]));
    const result = defaultEvaluationEngine.evaluate(flag, config, ctx, segMap);

    // Track evaluation timestamp for FR9 Flag Hygiene
    config.lastEvaluatedAt = new Date().toISOString();
    store.save();

    res.json({ result, bucket: defaultBucketingStrategy.computeBucket(flag.key, userKey) });
  });

  // =========================================================================
  // ROLLOUT BUCKET SIMULATOR (/api/v1/rollouts/simulate)
  // =========================================================================
  router.post('/rollouts/simulate', (req: Request, res: Response) => {
    const { flagKey = 'demo-flag', rolloutPercentage = 25, sampleSize = 5000 } = req.body ?? {};
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

    res.json({
      flagKey,
      sampleSize: n,
      targetPercentage: Number(rolloutPercentage),
      observedPercentage: Number(((inRolloutTotal / n) * 100).toFixed(2)),
      deciles,
    });
  });

  // =========================================================================
  // USER SEGMENTS (/api/v1/segments)
  // =========================================================================
  router.get('/segments', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    const list =
      projectId && projectId !== 'all'
        ? store.state.segments.filter((s) => s.projectId === projectId)
        : store.state.segments;
    res.json({ items: list });
  });

  router.post('/segments', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const { projectId, key, name, description = '', includedUsers = [], excludedUsers = [], rootGroup } =
      req.body ?? {};
    if (!projectId || !key || !name) {
      sendProblem(res, 400, 'Validation Error', 'projectId, key, and name are required.');
      return;
    }
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const now = new Date().toISOString();
    const segment: UserSegment = {
      id: `seg-${Date.now()}`,
      projectId: String(projectId),
      key: cleanKey,
      name: String(name).trim(),
      description: String(description).trim(),
      includedUsers: Array.isArray(includedUsers) ? includedUsers.map(String) : [],
      excludedUsers: Array.isArray(excludedUsers) ? excludedUsers.map(String) : [],
      rootGroup: rootGroup || { kind: 'group', id: `sg-${Date.now()}`, logicalOp: 'AND', children: [] },
      createdAt: now,
      updatedAt: now,
    };
    store.state.segments.unshift(segment);
    recordAudit(req, 'SEGMENT_CREATED', 'UserSegment', segment.id, `Created segment "${segment.name}".`);
    store.save();
    res.status(201).json({ segment });
  });

  router.put('/segments/:segmentId', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const seg = store.state.segments.find((s) => s.id === req.params.segmentId);
    if (!seg) {
      sendProblem(res, 404, 'Not Found', 'Segment not found.');
      return;
    }
    if (typeof req.body?.name === 'string') seg.name = req.body.name.trim();
    if (typeof req.body?.description === 'string') seg.description = req.body.description.trim();
    if (Array.isArray(req.body?.includedUsers)) seg.includedUsers = req.body.includedUsers.map(String);
    if (Array.isArray(req.body?.excludedUsers)) seg.excludedUsers = req.body.excludedUsers.map(String);
    if (req.body?.rootGroup) seg.rootGroup = req.body.rootGroup;
    seg.updatedAt = new Date().toISOString();
    recordAudit(req, 'SEGMENT_UPDATED', 'UserSegment', seg.id, `Updated segment "${seg.name}".`);
    store.save();
    res.json({ segment: seg });
  });

  router.delete('/segments/:segmentId', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const idx = store.state.segments.findIndex((s) => s.id === req.params.segmentId);
    if (idx === -1) {
      sendProblem(res, 404, 'Not Found', 'Segment not found.');
      return;
    }
    const [removed] = store.state.segments.splice(idx, 1);
    recordAudit(req, 'SEGMENT_DELETED', 'UserSegment', removed.id, `Deleted segment "${removed.name}".`);
    store.save();
    res.json({ deleted: true });
  });

  // =========================================================================
  // APPROVAL CENTER (/api/v1/approvals) — STRICT SELF-APPROVAL PREVENTION
  // =========================================================================
  router.get('/approvals', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const list =
      status && status !== 'ALL'
        ? store.state.changeRequests.filter((c) => c.status === status)
        : store.state.changeRequests;
    res.json({ items: list });
  });

  router.post('/approvals/:id/approve', (req: AuthedRequest, res: Response) => {
    if (!req.user || !canReviewApproval(req.user.role)) {
      sendProblem(res, 403, 'Forbidden', 'Only APPROVER or ADMIN roles can approve production changes.');
      return;
    }
    const cr = store.state.changeRequests.find((c) => c.id === req.params.id);
    if (!cr) {
      sendProblem(res, 404, 'Not Found', 'Change request not found.');
      return;
    }
    if (cr.status !== 'PENDING') {
      sendProblem(res, 409, 'Already Reviewed', `Change request is already ${cr.status}.`);
      return;
    }

    // FR7 MANDATORY: Prevent users from approving their own production changes!
    if (cr.authorId === req.user.id) {
      sendProblem(
        res,
        403,
        'Self-Approval Prohibited',
        'Security policy prevents authors from approving their own production change requests. Ask another Approver or Admin to review.',
      );
      return;
    }

    const cfg = store.state.flagConfigs.find(
      (c) => c.flagId === cr.flagId && c.environmentId === cr.environmentId,
    );
    if (!cfg) {
      sendProblem(res, 404, 'Not Found', 'Target flag configuration no longer exists.');
      return;
    }

    const updated = new ApplyFlagConfigCommand(
      cfg.id,
      cr.proposedConfig,
      req.user,
      `Approved CR ${cr.id} (${cr.reason})`,
      'APPROVAL_RESOLVED',
    ).execute();

    cr.status = 'APPROVED';
    cr.reviewerId = req.user.id;
    cr.reviewerName = req.user.name;
    cr.reviewComment = String(req.body?.comment || 'Approved for production rollout.');
    cr.reviewedAt = new Date().toISOString();
    store.save();

    res.json({ changeRequest: cr, config: updated });
  });

  router.post('/approvals/:id/reject', (req: AuthedRequest, res: Response) => {
    if (!req.user || !canReviewApproval(req.user.role)) {
      sendProblem(res, 403, 'Forbidden', 'Only APPROVER or ADMIN roles can reject production changes.');
      return;
    }
    const cr = store.state.changeRequests.find((c) => c.id === req.params.id);
    if (!cr) {
      sendProblem(res, 404, 'Not Found', 'Change request not found.');
      return;
    }
    if (cr.status !== 'PENDING') {
      sendProblem(res, 409, 'Already Reviewed', `Change request is already ${cr.status}.`);
      return;
    }

    cr.status = 'REJECTED';
    cr.reviewerId = req.user.id;
    cr.reviewerName = req.user.name;
    cr.reviewComment = String(req.body?.comment || 'Rejected by reviewer.');
    cr.reviewedAt = new Date().toISOString();
    recordAudit(req, 'APPROVAL_REJECTED', 'ChangeRequest', cr.id, `Rejected CR ${cr.id} for "${cr.flagKey}".`);
    store.save();
    res.json({ changeRequest: cr });
  });

  // =========================================================================
  // VERSION HISTORY, ROLLBACK & SCHEDULED CHANGES (/api/v1/versions, /schedules)
  // =========================================================================
  router.get('/versions', (req: Request, res: Response) => {
    const flagId = req.query.flagId as string | undefined;
    const environmentId = req.query.environmentId as string | undefined;
    let list = store.state.versions;
    if (flagId && flagId !== 'all') list = list.filter((v) => v.flagId === flagId);
    if (environmentId && environmentId !== 'all') list = list.filter((v) => v.environmentId === environmentId);

    const enriched = list.map((v) => {
      const flag = store.state.flags.find((f) => f.id === v.flagId);
      const env = store.state.environments.find((e) => e.id === v.environmentId);
      return {
        ...v,
        flagKey: flag?.key ?? v.flagId,
        flagName: flag?.name ?? v.flagId,
        environmentName: env?.name ?? v.environmentId,
      };
    });
    res.json({ items: enriched });
  });

  router.post('/versions/:versionId/rollback', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    try {
      const updated = new RollbackFlagConfigCommand(
        req.params.versionId,
        req.user!,
        String(req.body?.reason || 'Manual rollback from Change History'),
      ).execute();
      res.json({ config: updated });
    } catch (err) {
      sendProblem(res, 404, 'Rollback Failed', err instanceof Error ? err.message : 'Unable to rollback.');
    }
  });

  router.get('/schedules', (_req, res) => {
    processDueSchedules();
    res.json({ items: store.state.scheduledChanges });
  });

  router.post('/schedules', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const { flagId, environmentId, scheduledFor, reason = 'Scheduled rollout', patch } = req.body ?? {};
    const flag = store.state.flags.find((f) => f.id === flagId);
    const env = store.state.environments.find((e) => e.id === environmentId);
    if (!flag || !env || !scheduledFor || !patch) {
      sendProblem(res, 400, 'Validation Error', 'flagId, environmentId, scheduledFor, and patch are required.');
      return;
    }
    const item: ScheduledChange = {
      id: `sch-${Date.now()}`,
      flagId: flag.id,
      flagKey: flag.key,
      environmentId: env.id,
      environmentName: env.name,
      authorId: req.user!.id,
      authorName: req.user!.name,
      reason: String(reason),
      scheduledFor: String(scheduledFor),
      status: 'SCHEDULED',
      patch,
      createdAt: new Date().toISOString(),
    };
    store.state.scheduledChanges.unshift(item);
    recordAudit(req, 'CHANGE_SCHEDULED', 'ScheduledChange', item.id, `Scheduled change for "${flag.key}" at ${scheduledFor}.`);
    store.save();
    res.status(201).json({ schedule: item });
  });

  router.post('/schedules/:id/cancel', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const item = store.state.scheduledChanges.find((s) => s.id === req.params.id);
    if (!item) {
      sendProblem(res, 404, 'Not Found', 'Scheduled change not found.');
      return;
    }
    item.status = 'CANCELLED';
    store.save();
    res.json({ schedule: item });
  });

  // =========================================================================
  // EXPERIMENTS & ANALYTICS (/api/v1/experiments, /api/v1/analytics)
  // =========================================================================
  router.get('/experiments', (_req, res) => {
    res.json({ items: store.state.experiments });
  });

  router.post('/experiments', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const { projectId, environmentId, flagId, name, hypothesis = '', metricName = 'conversion' } = req.body ?? {};
    const flag = store.state.flags.find((f) => f.id === flagId);
    if (!flag || !name || !projectId || !environmentId) {
      sendProblem(res, 400, 'Validation Error', 'projectId, environmentId, flagId, and name are required.');
      return;
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
    store.state.experiments.unshift(exp);
    recordAudit(req, 'EXPERIMENT_CREATED', 'Experiment', exp.id, `Created experiment "${exp.name}".`);
    store.save();
    res.status(201).json({ experiment: exp });
  });

  router.get('/analytics/experiments', (_req, res) => {
    const db = store.state;
    const summaries = db.experiments.map((exp) => {
      const flag = db.flags.find((f) => f.id === exp.flagId);
      return computeExperimentAnalytics(exp, flag, db.exposures, db.conversions);
    });
    res.json({ items: summaries });
  });

  router.post('/analytics/experiments/:expId/simulate', requireMinRole('EDITOR'), (req: AuthedRequest, res: Response) => {
    const exp = store.state.experiments.find((e) => e.id === req.params.expId);
    if (!exp) {
      sendProblem(res, 404, 'Not Found', 'Experiment not found.');
      return;
    }
    const batchSize = Math.min(200, Math.max(10, Number(req.body?.count ?? 40)));
    const now = new Date().toISOString();
    for (let i = 0; i < batchSize; i++) {
      const isTreatment = i % 2 === 0;
      const vid = isTreatment ? exp.treatmentVariationId : exp.controlVariationId;
      const userKey = `sim-${Date.now()}-${i}`;
      store.state.exposures.push({
        id: `exp-sim-${Date.now()}-${i}`,
        experimentId: exp.id,
        flagKey: exp.flagKey,
        userKey,
        variationId: vid,
        timestamp: now,
      });
      const convProb = isTreatment ? 0.2 : 0.12;
      if ((i * 37) % 100 < convProb * 100) {
        store.state.conversions.push({
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
    store.save();
    const flag = store.state.flags.find((f) => f.id === exp.flagId);
    const summary = computeExperimentAnalytics(exp, flag, store.state.exposures, store.state.conversions);
    res.json({ summary });
  });

  // =========================================================================
  // FLAG HYGIENE (/api/v1/hygiene)
  // =========================================================================
  router.get('/hygiene', (_req, res) => {
    const db = store.state;
    const reports = detectStaleFlags(
      db.flags,
      db.flagConfigs,
      db.projects,
      db.environments,
      db.users.map(toPublicUser),
    );
    res.json({ items: reports });
  });

  // =========================================================================
  // TEAM MEMBERS & ROLES (/api/v1/users)
  // =========================================================================
  router.get('/users', (_req, res) => {
    res.json({
      items: store.state.users.map(toPublicUser),
      memberships: store.state.projectMembers,
    });
  });

  router.patch('/users/:userId', requireMinRole('ADMIN'), (req: AuthedRequest, res: Response) => {
    const target = store.state.users.find((u) => u.id === req.params.userId);
    if (!target) {
      sendProblem(res, 404, 'Not Found', 'User not found.');
      return;
    }
    const validRoles: Role[] = ['VIEWER', 'EDITOR', 'APPROVER', 'ADMIN'];
    if (req.body?.role && validRoles.includes(req.body.role)) {
      target.role = req.body.role;
    }
    if (typeof req.body?.active === 'boolean') {
      target.active = req.body.active;
    }
    recordAudit(req, 'USER_ROLE_UPDATED', 'User', target.id, `Updated ${target.email} role to ${target.role}.`);
    store.save();
    res.json({ user: toPublicUser(target) });
  });

  router.post('/users', requireMinRole('ADMIN'), (req: AuthedRequest, res: Response) => {
    const { email, name, role = 'VIEWER', password = 'flagship123' } = req.body ?? {};
    if (!email || !name) {
      sendProblem(res, 400, 'Validation Error', 'Email and name are required.');
      return;
    }
    const normalized = String(email).trim().toLowerCase();
    if (store.state.users.some((u) => u.email.toLowerCase() === normalized)) {
      sendProblem(res, 409, 'Conflict', 'User with this email already exists.');
      return;
    }
    const user = {
      id: `usr-${Date.now()}`,
      email: normalized,
      name: String(name).trim(),
      role: role as Role,
      passwordHash: hashPassword(String(password)),
      createdAt: new Date().toISOString(),
      active: true,
    };
    store.state.users.push(user);
    recordAudit(req, 'USER_INVITED', 'User', user.id, `Added team member ${user.name} (${user.role}).`);
    store.save();
    res.status(201).json({ user: toPublicUser(user) });
  });

  // =========================================================================
  // SDK INSTANCES & AUDIT LOGS (/api/v1/sdk/instances, /api/v1/audit)
  // =========================================================================
  router.get('/sdk/instances', (_req, res) => {
    res.json({ items: store.state.sdkInstances });
  });

  router.get('/audit', (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));
    const total = store.state.auditLogs.length;
    const start = (page - 1) * pageSize;
    res.json({
      items: store.state.auditLogs.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    });
  });

  router.post('/settings/reset-demo', requireMinRole('ADMIN'), (_req, res) => {
    store.reset();
    eventBus.publish({
      type: 'FLAG_CONFIG_UPDATED',
      summary: 'Demo dataset reset to clean baseline',
    });
    res.json({ reset: true });
  });

  return router;
}
