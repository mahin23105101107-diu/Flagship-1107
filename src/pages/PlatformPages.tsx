import React, { useEffect, useState } from 'react';
import {
  Activity,
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  RotateCcw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiRequest, isStaticMode } from '../api/client';
import { localSdkFetch } from '../api/localBackend';
import { EvaluationContextBuilder } from '../engine/evaluation';
import { FlagShipClient, MemorySnapshotStorage } from '../engine/sdkClient';
import type {
  AuditLog,
  Environment,
  PublicUser,
  Role,
  SdkInstance,
  SdkSnapshot,
} from '../types/flagship';

interface TeamPageProps {
  user: PublicUser;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const TeamMembersPage: React.FC<TeamPageProps> = ({ user, onNotify }) => {
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EDITOR');

  const load = async () => {
    const res = await apiRequest<{ items: PublicUser[] }>('/users');
    setMembers(res.items);
  };

  useEffect(() => {
    void load();
  }, []);

  const updateRole = async (id: string, nextRole: Role) => {
    try {
      await apiRequest(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      onNotify('success', 'Role updated', `Assigned ${nextRole} permission.`);
      void load();
    } catch (err) {
      onNotify('error', 'Update failed', err instanceof Error ? err.message : 'Admin required');
    }
  };

  const toggleActive = async (m: PublicUser) => {
    try {
      await apiRequest(`/users/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !m.active }),
      });
      onNotify('info', m.active ? 'Account deactivated' : 'Account reactivated', m.email);
      void load();
    } catch (err) {
      onNotify('error', 'Failed', err instanceof Error ? err.message : 'Admin required');
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({ name, email, role }),
      });
      setShowInvite(false);
      setName('');
      setEmail('');
      onNotify('success', 'Member added', `${name} added with ${role} role (default password: flagship123).`);
      void load();
    } catch (err) {
      onNotify('error', 'Invite failed', err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Team Members & Roles
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Enforce least-privilege RBAC across Viewer, Editor, Approver, and Admin roles.
          </p>
        </div>
        {user.role === 'ADMIN' && (
          <button
            type="button"
            onClick={() => setShowInvite((s) => !s)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Add Member</span>
          </button>
        )}
      </div>

      {showInvite && (
        <form
          onSubmit={invite}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label htmlFor="m-name" className="block text-xs text-slate-500 mb-1">Full Name</label>
            <input
              id="m-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Samira Patel"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="m-email" className="block text-xs text-slate-500 mb-1">Email</label>
            <input
              id="m-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="samira@flagship.io"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="m-role" className="block text-xs text-slate-500 mb-1">Role</label>
            <select
              id="m-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              <option value="VIEWER">VIEWER</option>
              <option value="EDITOR">EDITOR</option>
              <option value="APPROVER">APPROVER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <button type="submit" className="px-4 py-2 rounded-md bg-indigo-600 text-white text-xs font-medium">
            Create Member
          </button>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Access Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{m.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">{m.email}</td>
                  <td className="px-4 py-3">
                    {user.role === 'ADMIN' && m.id !== user.id ? (
                      <select
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        onChange={(e) => void updateRole(m.id, e.target.value as Role)}
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 font-mono text-xs"
                      >
                        <option value="VIEWER">VIEWER</option>
                        <option value="EDITOR">EDITOR</option>
                        <option value="APPROVER">APPROVER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    ) : (
                      <span className="font-mono font-medium">{m.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={m.active ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-slate-400'}>
                      {m.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {user.role === 'ADMIN' && m.id !== user.id && (
                      <button
                        type="button"
                        onClick={() => void toggleActive(m)}
                        className="text-slate-600 dark:text-slate-400 hover:text-indigo-600 font-medium"
                      >
                        {m.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface SdkSetupPageProps {
  environments: Environment[];
  selectedEnvId: string;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const SdkSetupPage: React.FC<SdkSetupPageProps> = ({
  environments,
  selectedEnvId,
  onNotify,
}) => {
  const env = environments.find((e) => e.id === selectedEnvId) ?? environments[0];
  const [simOffline, setSimOffline] = useState(false);
  const [simFlagKey, setSimFlagKey] = useState('new-checkout-flow');
  const [simUserKey, setSimUserKey] = useState('alice@acme.io');
  const [sdkSnapshot, setSdkSnapshot] = useState<SdkSnapshot | null>(null);
  const [evalLog, setEvalLog] = useState<string[]>([]);

  const syncLocalSdk = async () => {
    if (!env) return;
    const storage = new MemorySnapshotStorage();
    if (sdkSnapshot) storage.save(sdkSnapshot);

    const client = new FlagShipClient({
      serverUrl: window.location.origin,
      sdkKey: env.sdkKey,
      startupTimeoutMs: 1200,
      storage,
      fetcher: simOffline
        ? ((async () => {
            throw new Error('Simulated Server Outage (ECONNREFUSED)');
          }) as typeof fetch)
        : isStaticMode()
          ? localSdkFetch
          : fetch.bind(window),
    });

    const synced = await client.initialize();
    const snap = client.getSnapshot();
    if (snap) setSdkSnapshot(snap);

    const ctx = EvaluationContextBuilder.create(simUserKey)
      .withAttribute('plan', 'enterprise')
      .withAttribute('appVersion', '2.5.0')
      .withAttribute('country', 'US')
      .build();
    const res = client.evaluate(simFlagKey, ctx, false);
    const modeLabel = synced ? 'ONLINE_SYNCED' : snap ? 'OFFLINE_SNAPSHOT_CACHE' : 'OFFLINE_SAFE_DEFAULT';

    setEvalLog((prev) => [
      `[${new Date().toLocaleTimeString()}] mode=${modeLabel} flag=${simFlagKey} user=${simUserKey} -> value=${JSON.stringify(res.value)} reason=${res.reason} (${res.evaluationTimeMicros}µs)`,
      ...prev.slice(0, 9),
    ]);
  };

  const copySnippet = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback toast only
    }
    onNotify('info', `${label} copied`);
  };

  const mavenXml = `<dependency>
  <groupId>io.flagship</groupId>
  <artifactId>flagship-spring-boot-starter</artifactId>
  <version>1.0.0</version>
</dependency>`;

  const appYml = `flagship:
  server-url: http://localhost:8080
  sdk-key: ${env?.sdkKey ?? 'fs_prod_your_key'}
  startup-timeout-ms: 1500
  snapshot-path: ./data/flagship-snapshot.json
  sse-enabled: true
  polling-fallback-interval-ms: 30000`;

  const javaCode = `@RestController
public class CheckoutController {
  private final FlagShipClient flagShip;

  public CheckoutController(FlagShipClient flagShip) {
    this.flagShip = flagShip;
  }

  @FeatureFlag(value = "new-checkout-flow", fallbackMethod = "legacyCheckout")
  @GetMapping("/checkout")
  public ResponseEntity<String> expressCheckout(@RequestParam String userId) {
    EvaluationContext ctx = EvaluationContext.builder(userId)
        .attribute("plan", "enterprise")
        .build();
    String layout = flagShip.getString("homepage-layout", ctx, "classic-grid");
    return ResponseEntity.ok("Express checkout active · layout=" + layout);
  }
}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Spring Boot Starter SDK Setup
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Integrate <code className="font-mono">flagship-spring-boot-starter</code> in under 15 minutes with zero boilerplate and built-in offline snapshot resilience.
        </p>
      </div>

      {/* Live Interactive Offline Resilience & Local Snapshot Simulator */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Interactive SDK & Offline Resilience Simulator (FR6 / QA2)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sync a live snapshot, toggle Server Offline, and verify zero uncaught exceptions and sub-50µs local evaluation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSimOffline((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium border transition-colors ${
              simOffline
                ? 'border-red-300 bg-red-600 text-white'
                : 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
            }`}
          >
            {simOffline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            <span>{simOffline ? 'Server Outage Simulated (Offline)' : 'Central Server Reachable (Online)'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-4">
            <label htmlFor="sim-flag" className="block text-xs text-slate-500 mb-1">Flag Key</label>
            <input
              id="sim-flag"
              value={simFlagKey}
              onChange={(e) => setSimFlagKey(e.target.value)}
              className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="sim-user" className="block text-xs text-slate-500 mb-1">User Key</label>
            <input
              id="sim-user"
              value={simUserKey}
              onChange={(e) => setSimUserKey(e.target.value)}
              className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-4">
            <button
              type="button"
              onClick={() => void syncLocalSdk()}
              className="w-full px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
            >
              Run SDK Sync & Evaluate
            </button>
          </div>
        </div>

        {evalLog.length > 0 && (
          <pre className="rounded-md bg-slate-950 text-slate-200 p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
            {evalLog.join('\n')}
          </pre>
        )}
      </section>

      {/* Code Snippets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">1. Add Maven Starter Dependency</h2>
            <button type="button" onClick={() => void copySnippet(mavenXml, 'Maven dependency')} className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
          <pre className="rounded-md bg-slate-950 text-slate-100 p-4 text-xs font-mono overflow-x-auto">
            {mavenXml}
          </pre>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">2. Configure application.yml ({env?.name})</h2>
            <button type="button" onClick={() => void copySnippet(appYml, 'application.yml')} className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
          <pre className="rounded-md bg-slate-950 text-slate-100 p-4 text-xs font-mono overflow-x-auto">
            {appYml}
          </pre>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold">3. Guard Endpoints with @FeatureFlag & FlagShipClient</h2>
          <button type="button" onClick={() => void copySnippet(javaCode, 'Java example')} className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
        <pre className="rounded-md bg-slate-950 text-slate-100 p-4 text-xs font-mono overflow-x-auto">
          {javaCode}
        </pre>
      </div>
    </div>
  );
};

interface SystemHealthPageProps {
  refreshSignal: number;
}

export const SystemHealthPage: React.FC<SystemHealthPageProps> = ({ refreshSignal }) => {
  const [health, setHealth] = useState<{
    status: string;
    readiness: string;
    uptimeSeconds: number;
    revision: number;
    components: Record<string, { status: string; activeStreams?: number; bucketingAlgorithm?: string; engine?: string }>;
    metrics: {
      heapUsedMb: number;
      rssMb: number;
      connectedSdkInstances: number;
      recentEvents: Array<{ id: string; type: string; summary: string; publishedAt: string; revision: number }>;
    };
  } | null>(null);
  const [instances, setInstances] = useState<SdkInstance[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const load = async () => {
    const [h, s, a] = await Promise.all([
      apiRequest<typeof health>('/health'),
      apiRequest<{ items: SdkInstance[] }>('/sdk/instances'),
      apiRequest<{ items: AuditLog[] }>('/audit?pageSize=12'),
    ]);
    setHealth(h);
    setInstances(s.items);
    setAuditLogs(a.items);
  };

  useEffect(() => {
    void load();
  }, [refreshSignal]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            System Health & Observability
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Actuator readiness probes, SSE propagation telemetry, connected SDK fleet, and audit logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={isStaticMode() ? './openapi.json' : '/api/v1/openapi.json'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>OpenAPI 3.1 JSON</span>
          </a>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {health && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Server Health</div>
            <div className="mt-1.5 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {health.status} · {health.readiness}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Active SSE Streams</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
              {health.components.sseBroadcaster?.activeStreams ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Config Revision</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
              r{health.revision}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Heap Usage</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
              {health.metrics.heapUsedMb} MB
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Bucketing Engine</div>
            <div className="mt-1.5 font-mono text-base font-semibold">
              {health.components.evaluationEngine?.bucketingAlgorithm}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
            Registered SDK Instances ({instances.length})
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {instances.map((inst) => (
              <div key={inst.id} className="px-5 py-3 flex items-center justify-between text-xs">
                <div>
                  <div className="font-mono font-semibold text-slate-900 dark:text-white">{inst.instanceName}</div>
                  <div className="text-slate-500 mt-0.5">{inst.sdkVersion} · {inst.transport}</div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-emerald-700 dark:text-emerald-400 font-semibold">{inst.status}</div>
                  <div className="text-slate-500">{inst.lastSyncLatencyMs} ms</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 font-display text-sm font-semibold">
            <Activity className="w-4 h-4 text-indigo-600" />
            <span>Recent Audit Trail</span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-80 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="px-5 py-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">{log.action}</span>
                  <span className="text-slate-500 tabular-nums">{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 mt-0.5">{log.summary}</p>
                <div className="text-slate-400 mt-0.5">{log.actorName} ({log.actorRole})</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

interface SettingsPageProps {
  user: PublicUser;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onRefresh: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  user,
  darkMode,
  onToggleDarkMode,
  onRefresh,
  onNotify,
}) => {
  const [resetting, setResetting] = useState(false);

  const resetDemo = async () => {
    setResetting(true);
    try {
      await apiRequest('/settings/reset-demo', { method: 'POST' });
      onNotify('success', 'Workspace reset', 'Restored clean FlagShip baseline dataset.');
      onRefresh();
    } catch (err) {
      onNotify('error', 'Reset failed', err instanceof Error ? err.message : 'Admin role required');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Workspace Settings
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Appearance preferences, active operator profile, and administrative controls.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Interface Theme
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Switch between light and dark developer console palettes.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
          Authenticated Profile
        </h2>
        <dl className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium text-slate-900 dark:text-white mt-0.5">{user.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-mono text-slate-900 dark:text-white mt-0.5">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Assigned Role</dt>
            <dd className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">{user.role}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Evaluation Algorithm</dt>
            <dd className="font-mono text-slate-900 dark:text-white mt-0.5">MurmurHash3 32-bit (Seed 0)</dd>
          </div>
        </dl>
      </section>

      {user.role === 'ADMIN' && (
        <section className="rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-red-700 dark:text-red-400">
              Reset Demo Dataset
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Restores default projects, environments, flags, pending approvals, and experiments.
            </p>
          </div>
          <button
            type="button"
            disabled={resetting}
            onClick={() => void resetDemo()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{resetting ? 'Resetting...' : 'Reset Baseline Data'}</span>
          </button>
        </section>
      )}
    </div>
  );
};
