import React, { useEffect, useState } from 'react';
import { CalendarClock, Check, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { apiRequest } from '../api/client';
import type {
  ChangeRequest,
  FlagEnvironmentConfig,
  FlagVersion,
  PublicUser,
  ScheduledChange,
} from '../types/flagship';
import type { EnrichedFlag } from './FlagsPages';

interface EnrichedVersion extends FlagVersion {
  flagKey: string;
  flagName: string;
  environmentName: string;
}

function summarizeConfigDiff(
  before: FlagEnvironmentConfig | null,
  after: FlagEnvironmentConfig,
): Array<{ field: string; before: string; after: string }> {
  if (!before) {
    return [
      { field: 'enabled', before: '—', after: String(after.enabled) },
      { field: 'rolloutPercentage', before: '—', after: `${after.rolloutPercentage}%` },
    ];
  }
  const rows: Array<{ field: string; before: string; after: string }> = [];
  if (before.enabled !== after.enabled) {
    rows.push({ field: 'enabled', before: String(before.enabled), after: String(after.enabled) });
  }
  if (before.killSwitchActive !== after.killSwitchActive) {
    rows.push({
      field: 'killSwitchActive',
      before: String(before.killSwitchActive),
      after: String(after.killSwitchActive),
    });
  }
  if (before.rolloutPercentage !== after.rolloutPercentage) {
    rows.push({
      field: 'rolloutPercentage',
      before: `${before.rolloutPercentage}%`,
      after: `${after.rolloutPercentage}%`,
    });
  }
  if (before.rolloutVariationId !== after.rolloutVariationId) {
    rows.push({
      field: 'rolloutVariationId',
      before: before.rolloutVariationId,
      after: after.rolloutVariationId,
    });
  }
  if (JSON.stringify(before.targetingRules) !== JSON.stringify(after.targetingRules)) {
    rows.push({
      field: 'targetingRules',
      before: `${before.targetingRules.length} rule(s)`,
      after: `${after.targetingRules.length} rule(s)`,
    });
  }
  if (JSON.stringify(before.individualTargets) !== JSON.stringify(after.individualTargets)) {
    rows.push({
      field: 'individualTargets',
      before: `${before.individualTargets.reduce((a, t) => a + t.userKeys.length, 0)} user(s)`,
      after: `${after.individualTargets.reduce((a, t) => a + t.userKeys.length, 0)} user(s)`,
    });
  }
  return rows.length > 0
    ? rows
    : [{ field: 'version', before: `v${before.version}`, after: `v${after.version}` }];
}

interface ChangeHistoryPageProps {
  projectId: string;
  environmentId: string;
  user: PublicUser;
  refreshSignal: number;
  onRefresh: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const ChangeHistoryPage: React.FC<ChangeHistoryPageProps> = ({
  projectId,
  environmentId,
  user,
  refreshSignal,
  onRefresh,
  onNotify,
}) => {
  const [versions, setVersions] = useState<EnrichedVersion[]>([]);
  const [schedules, setSchedules] = useState<ScheduledChange[]>([]);
  const [flags, setFlags] = useState<EnrichedFlag[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<EnrichedVersion | null>(null);

  // Schedule form
  const [showSchedule, setShowSchedule] = useState(false);
  const [schFlagId, setSchFlagId] = useState('');
  const [schRollout, setSchRollout] = useState(100);
  const [schDate, setSchDate] = useState(
    new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16),
  );
  const [schReason, setSchReason] = useState('Scheduled gradual rollout');

  const load = async () => {
    const [vRes, sRes, fRes] = await Promise.all([
      apiRequest<{ items: EnrichedVersion[] }>('/versions'),
      apiRequest<{ items: ScheduledChange[] }>('/schedules'),
      apiRequest<{ items: EnrichedFlag[] }>(`/flags?projectId=${projectId}&environmentId=${environmentId}&pageSize=50`),
    ]);
    setVersions(vRes.items);
    setSchedules(sRes.items);
    setFlags(fRes.items);
    if (!schFlagId && fRes.items[0]) setSchFlagId(fRes.items[0].id);
    if (!selectedVersion && vRes.items[0]) setSelectedVersion(vRes.items[0]);
  };

  useEffect(() => {
    void load();
  }, [projectId, environmentId, refreshSignal]);

  const handleRollback = async (ver: EnrichedVersion) => {
    try {
      await apiRequest(`/versions/${ver.id}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ reason: `Rollback ${ver.flagKey} to v${ver.version}` }),
      });
      onNotify('success', 'Rollback applied', `${ver.flagKey} restored to snapshot v${ver.version}.`);
      onRefresh();
      void load();
    } catch (err) {
      onNotify('error', 'Rollback failed', err instanceof Error ? err.message : 'Error');
    }
  };

  const createSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/schedules', {
        method: 'POST',
        body: JSON.stringify({
          flagId: schFlagId,
          environmentId,
          scheduledFor: new Date(schDate).toISOString(),
          reason: schReason,
          patch: { enabled: true, rolloutPercentage: Number(schRollout) },
        }),
      });
      setShowSchedule(false);
      onNotify('success', 'Change scheduled', `Will apply at ${new Date(schDate).toLocaleString()}`);
      void load();
    } catch (err) {
      onNotify('error', 'Schedule failed', err instanceof Error ? err.message : 'Error');
    }
  };

  const cancelSchedule = async (id: string) => {
    await apiRequest(`/schedules/${id}/cancel`, { method: 'POST' });
    onNotify('info', 'Schedule cancelled');
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Change History & Schedules
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Immutable versioned snapshots with before/after configuration diffs, instant rollback, and scheduled releases.
          </p>
        </div>
        {user.role !== 'VIEWER' && (
          <button
            type="button"
            onClick={() => setShowSchedule((s) => !s)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <CalendarClock className="w-4 h-4" />
            <span>Schedule Change</span>
          </button>
        )}
      </div>

      {showSchedule && (
        <form
          onSubmit={createSchedule}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Schedule Rollout Change
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sch-flag" className="block text-xs text-slate-500 mb-1">Flag</label>
              <select
                id="sch-flag"
                value={schFlagId}
                onChange={(e) => setSchFlagId(e.target.value)}
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              >
                {flags.map((f) => (
                  <option key={f.id} value={f.id}>{f.key}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sch-rollout" className="block text-xs text-slate-500 mb-1">Target Rollout (%)</label>
              <input
                id="sch-rollout"
                type="number"
                min={0}
                max={100}
                value={schRollout}
                onChange={(e) => setSchRollout(Number(e.target.value))}
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label htmlFor="sch-time" className="block text-xs text-slate-500 mb-1">Execute At</label>
              <input
                id="sch-time"
                type="datetime-local"
                required
                value={schDate}
                onChange={(e) => setSchDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </div>
          </div>
          <input
            value={schReason}
            onChange={(e) => setSchReason(e.target.value)}
            placeholder="Reason for scheduled release"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowSchedule(false)} className="px-3.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md">Cancel</button>
            <button type="submit" className="px-4 py-2 text-xs bg-indigo-600 text-white rounded-md font-medium">Create Schedule</button>
          </div>
        </form>
      )}

      {/* Version Timeline + Diff Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
            Version Timeline ({versions.length})
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[460px] overflow-y-auto">
            {versions.map((ver) => (
              <div
                key={ver.id}
                className={`px-5 py-3.5 flex items-start justify-between gap-4 transition-colors ${
                  selectedVersion?.id === ver.id
                    ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedVersion(ver)}
                  className="text-left min-w-0 flex-1"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {ver.flagKey}
                    </span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">v{ver.version}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600 dark:text-slate-400">{ver.environmentName}</span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">{ver.reason}</p>
                  <div className="text-xs text-slate-500 mt-1">
                    {ver.authorName} · {new Date(ver.createdAt).toLocaleString()}
                  </div>
                </button>
                {user.role !== 'VIEWER' && (
                  <button
                    type="button"
                    onClick={() => void handleRollback(ver)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rollback</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Before / After Configuration Diff
          </h2>
          {!selectedVersion ? (
            <p className="text-xs text-slate-500">Select a version entry to inspect its diff.</p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-slate-500">
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {selectedVersion.flagKey}
                </span>{' '}
                · v{selectedVersion.version} · {selectedVersion.environmentName}
              </div>
              <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Before</th>
                    <th className="px-3 py-2 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                  {summarizeConfigDiff(selectedVersion.beforeSnapshot, selectedVersion.afterSnapshot).map((d) => (
                    <tr key={d.field}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{d.field}</td>
                      <td className="px-3 py-2 text-red-600 dark:text-red-400">{d.before}</td>
                      <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">{d.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Scheduled Changes */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
          Scheduled Releases ({schedules.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-2.5 font-medium">Flag</th>
                <th className="px-4 py-2.5 font-medium">Environment</th>
                <th className="px-4 py-2.5 font-medium">Scheduled For</th>
                <th className="px-4 py-2.5 font-medium">Reason</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {schedules.map((sch) => (
                <tr key={sch.id}>
                  <td className="px-5 py-2.5 font-mono font-medium">{sch.flagKey}</td>
                  <td className="px-4 py-2.5">{sch.environmentName}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums">
                    {new Date(sch.scheduledFor).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{sch.reason}</td>
                  <td className="px-4 py-2.5 font-medium">{sch.status}</td>
                  <td className="px-5 py-2.5 text-right">
                    {sch.status === 'SCHEDULED' && user.role !== 'VIEWER' && (
                      <button
                        type="button"
                        onClick={() => void cancelSchedule(sch.id)}
                        className="text-red-600 hover:underline font-medium"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

interface ApprovalCenterPageProps {
  user: PublicUser;
  refreshSignal: number;
  onRefresh: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const ApprovalCenterPage: React.FC<ApprovalCenterPageProps> = ({
  user,
  refreshSignal,
  onRefresh,
  onNotify,
}) => {
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const res = await apiRequest<{ items: ChangeRequest[] }>(`/approvals?status=${filter}`);
    setItems(res.items);
  };

  useEffect(() => {
    void load();
  }, [filter, refreshSignal]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      await apiRequest(`/approvals/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          comment: action === 'approve' ? 'Verified diff and approved for Production.' : 'Rejected during review.',
        }),
      });
      onNotify(
        action === 'approve' ? 'success' : 'info',
        action === 'approve' ? 'Production change approved & live' : 'Change request rejected',
        action === 'approve' ? 'Updated config broadcasted to SDK clients via SSE.' : undefined,
      );
      onRefresh();
      void load();
    } catch (err) {
      onNotify('error', 'Approval blocked', err instanceof Error ? err.message : 'Action rejected by server');
    } finally {
      setBusyId(null);
    }
  };

  const canReview = user.role === 'APPROVER' || user.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Production Approval Center
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Dual-control change review for protected Production environments. Authors cannot approve their own requests.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-md bg-slate-100 dark:bg-slate-800">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                filter === tab
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            No {filter === 'ALL' ? '' : filter.toLowerCase()} change requests
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Modifications made to Production flags automatically appear here before activation.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((cr) => {
            const isSelf = cr.authorId === user.id;
            const diffs = summarizeConfigDiff(cr.beforeConfig, cr.proposedConfig);
            return (
              <div
                key={cr.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">
                        {cr.flagKey}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600 dark:text-slate-400">{cr.environmentName}</span>
                      <span className="text-slate-400">·</span>
                      <span
                        className={`font-semibold ${
                          cr.status === 'PENDING'
                            ? 'text-amber-700 dark:text-amber-400'
                            : cr.status === 'APPROVED'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {cr.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">{cr.reason}</p>
                    <div className="text-xs text-slate-500 mt-1">
                      Author: {cr.authorName} · Submitted {new Date(cr.createdAt).toLocaleString()}
                      {cr.reviewerName ? ` · Reviewed by ${cr.reviewerName}` : ''}
                    </div>
                  </div>

                  {cr.status === 'PENDING' && (
                    <div className="flex items-center gap-2 shrink-0">
                      {isSelf && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 mr-1">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Self-approval blocked</span>
                        </span>
                      )}
                      {canReview && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === cr.id}
                            onClick={() => void act(cr.id, 'reject')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === cr.id || isSelf}
                            title={isSelf ? 'Authors cannot approve their own production changes (FR7)' : 'Approve and publish'}
                            onClick={() => void act(cr.id, 'approve')}
                            className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-medium"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve & Publish</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Inline Diff Table */}
                <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Property</th>
                      <th className="px-3 py-2 font-medium">Current Active</th>
                      <th className="px-3 py-2 font-medium">Proposed Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                    {diffs.map((d) => (
                      <tr key={d.field}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{d.field}</td>
                        <td className="px-3 py-2 text-slate-500">{d.before}</td>
                        <td className="px-3 py-2 text-indigo-700 dark:text-indigo-400 font-semibold">{d.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
