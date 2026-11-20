import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Archive, CheckCircle2, Play, Plus, Search } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { ExperimentAnalyticsSummary } from '../engine/analytics';
import type { PublicUser, StaleFlagReport } from '../types/flagship';
import type { EnrichedFlag } from './FlagsPages';

interface AnalyticsPageProps {
  projectId: string;
  environmentId: string;
  user: PublicUser;
  refreshSignal: number;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const ExperimentAnalyticsPage: React.FC<AnalyticsPageProps> = ({
  projectId,
  environmentId,
  user,
  refreshSignal,
  onNotify,
}) => {
  const [summaries, setSummaries] = useState<ExperimentAnalyticsSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [flags, setFlags] = useState<EnrichedFlag[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [expName, setExpName] = useState('');
  const [expFlagId, setExpFlagId] = useState('');
  const [expMetric, setExpMetric] = useState('checkout_completed');
  const [expHypothesis, setExpHypothesis] = useState('');
  const [simulating, setSimulating] = useState(false);

  const load = async () => {
    const [aRes, fRes] = await Promise.all([
      apiRequest<{ items: ExperimentAnalyticsSummary[] }>('/analytics/experiments'),
      apiRequest<{ items: EnrichedFlag[] }>(`/flags?projectId=${projectId}&environmentId=${environmentId}&pageSize=50`),
    ]);
    setSummaries(aRes.items);
    setFlags(fRes.items);
    if (!selectedId && aRes.items[0]) setSelectedId(aRes.items[0].experimentId);
    if (!expFlagId && fRes.items[0]) setExpFlagId(fRes.items[0].id);
  };

  useEffect(() => {
    void load();
  }, [projectId, environmentId, refreshSignal]);

  const active = summaries.find((s) => s.experimentId === selectedId) ?? summaries[0];

  const simulateTraffic = async () => {
    if (!active) return;
    setSimulating(true);
    try {
      await apiRequest(`/analytics/experiments/${active.experimentId}/simulate`, {
        method: 'POST',
        body: JSON.stringify({ count: 60 }),
      });
      onNotify('success', 'Batched events ingested', 'Recorded 60 exposure and conversion events via analytics pipeline.');
      void load();
    } catch (err) {
      onNotify('error', 'Simulation failed', err instanceof Error ? err.message : 'Error');
    } finally {
      setSimulating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/experiments', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          environmentId,
          flagId: expFlagId,
          name: expName,
          metricName: expMetric,
          hypothesis: expHypothesis,
        }),
      });
      setShowCreate(false);
      setExpName('');
      setExpHypothesis('');
      onNotify('success', 'Experiment created', expName);
      void load();
    } catch (err) {
      onNotify('error', 'Failed', err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Experiment Analytics
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Track batched exposures, conversion lift, two-proportion z-test significance, and Chi-square Sample Ratio Mismatch (SRM).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {active && user.role !== 'VIEWER' && (
            <button
              type="button"
              disabled={simulating}
              onClick={() => void simulateTraffic()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{simulating ? 'Ingesting...' : 'Ingest Sample Batch'}</span>
            </button>
          )}
          {user.role !== 'VIEWER' && (
            <button
              type="button"
              onClick={() => setShowCreate((s) => !s)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
            >
              <Plus className="w-4 h-4" />
              <span>New Experiment</span>
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              required
              value={expName}
              onChange={(e) => setExpName(e.target.value)}
              placeholder="Experiment Name"
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <select
              value={expFlagId}
              onChange={(e) => setExpFlagId(e.target.value)}
              className="font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              {flags.map((f) => (
                <option key={f.id} value={f.id}>{f.key}</option>
              ))}
            </select>
            <input
              required
              value={expMetric}
              onChange={(e) => setExpMetric(e.target.value)}
              placeholder="Primary Metric (e.g. order_completed)"
              className="font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <input
            value={expHypothesis}
            onChange={(e) => setExpHypothesis(e.target.value)}
            placeholder="Hypothesis"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-3.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md">Cancel</button>
            <button type="submit" className="px-4 py-2 text-xs bg-indigo-600 text-white rounded-md font-medium">Start Experiment</button>
          </div>
        </form>
      )}

      {/* Experiment Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {summaries.map((s) => (
          <button
            key={s.experimentId}
            type="button"
            onClick={() => setSelectedId(s.experimentId)}
            className={`px-3.5 py-2 rounded-md border text-xs font-medium transition-colors ${
              active?.experimentId === s.experimentId
                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <span>{s.experimentName}</span>
            {s.srmDetected && <span className="ml-2 text-red-600 dark:text-red-400">(SRM Alert)</span>}
          </button>
        ))}
      </div>

      {active && (
        <div className="space-y-6">
          {/* SRM Alert Banner */}
          {active.srmDetected && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-800 dark:text-red-200">
                <div className="font-semibold text-sm">Sample Ratio Mismatch (SRM) Detected</div>
                <p className="mt-1">
                  Chi-square statistic <code className="font-mono">{active.srmChiSquare}</code> (p ={' '}
                  <code className="font-mono">{active.srmPValue}</code> &lt; 0.01). Observed traffic split deviates significantly from the expected 50/50 allocation. Investigate targeting rules or SDK exposure logging before trusting lift results.
                </p>
              </div>
            </div>
          )}

          {/* Metric Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Total Exposures</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {active.totalExposures.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Total Conversions</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {active.totalConversions.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Overall Conv. Rate</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {active.overallConversionRate}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Statistical Significance</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums whitespace-nowrap">
                p={active.pValue}
              </div>
              <div className="mt-1 text-xs font-medium flex items-center gap-1.5">
                {active.statisticallySignificant ? (
                  <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> z={active.zScore} · Sig.
                  </span>
                ) : (
                  <span className="text-slate-500 font-mono tabular-nums">z={active.zScore} · Not sig.</span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">SRM Health</div>
              <div
                className={`mt-1.5 text-lg font-semibold ${
                  active.srmDetected
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {active.srmDetected ? 'SRM Warning' : 'Balanced'}
              </div>
              <div className="font-mono text-xs text-slate-500 tabular-nums mt-0.5">
                χ²={active.srmChiSquare} · p={active.srmPValue}
              </div>
            </div>
          </div>

          {/* Chart + Breakdown Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="font-display text-base font-semibold mb-4">
                Conversion Rate (%) by Variation
              </h2>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={active.variations} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                    <XAxis dataKey="variationName" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit="%" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="conversionRate" name="Conversion Rate (%)" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="observedShare" name="Observed Traffic (%)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 font-display text-base font-semibold">
                Variation Performance ({active.metricName})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Variation</th>
                      <th className="px-3 py-2.5 font-medium text-right">Exposures</th>
                      <th className="px-3 py-2.5 font-medium text-right">Conversions</th>
                      <th className="px-3 py-2.5 font-medium text-right">Conv. Rate</th>
                      <th className="px-3 py-2.5 font-medium text-right">Traffic Share</th>
                      <th className="px-4 py-2.5 font-medium text-right">Lift</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {active.variations.map((v) => (
                      <tr key={v.variationId}>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {v.variationName}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{v.exposures}</td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{v.conversions}</td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold">
                          {v.conversionRate}%
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {v.observedShare}% / {v.expectedShare}%
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                            v.liftVsControl === null
                              ? 'text-slate-400'
                              : v.liftVsControl >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {v.liftVsControl === null ? 'Baseline' : `${v.liftVsControl >= 0 ? '+' : ''}${v.liftVsControl}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface HygienePageProps {
  user: PublicUser;
  refreshSignal: number;
  onRefresh: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const FlagHygienePage: React.FC<HygienePageProps> = ({
  user,
  refreshSignal,
  onRefresh,
  onNotify,
}) => {
  const [reports, setReports] = useState<StaleFlagReport[]>([]);
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState<'ALL' | 'NOT_EVALUATED_30D' | 'FULL_ROLLOUT_14D'>('ALL');

  const load = async () => {
    const res = await apiRequest<{ items: StaleFlagReport[] }>('/hygiene');
    setReports(res.items);
  };

  useEffect(() => {
    void load();
  }, [refreshSignal]);

  const archiveFlag = async (r: StaleFlagReport) => {
    try {
      await apiRequest(`/flags/${r.flagId}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      onNotify('success', 'Stale flag archived', `${r.flagKey} removed from active evaluation pool.`);
      onRefresh();
      void load();
    } catch (err) {
      onNotify('error', 'Archive failed', err instanceof Error ? err.message : 'Error');
    }
  };

  const filtered = reports.filter((r) => {
    if (reasonFilter !== 'ALL' && r.staleReason !== reasonFilter && r.staleReason !== 'BOTH') {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        r.flagKey.toLowerCase().includes(q) ||
        r.flagName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.ownerName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Flag Hygiene
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Automatically detects technical debt: flags unevaluated for 30+ days or stuck at 100% rollout for 14+ days.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Filter stale flags"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stale flags by name, project, or owner..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-md bg-slate-100 dark:bg-slate-800">
          {([
            ['ALL', 'All Stale'],
            ['NOT_EVALUATED_30D', 'Unused ≥ 30d'],
            ['FULL_ROLLOUT_14D', '100% ≥ 14d'],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setReasonFilter(val)}
              className={`px-2.5 py-1 text-xs font-medium rounded ${
                reasonFilter === val
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No stale flags found matching your filter. Your flag inventory is healthy.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-5 py-3 font-medium">Flag</th>
                  <th className="px-4 py-3 font-medium">Project / Env</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium text-right">Last Eval</th>
                  <th className="px-4 py-3 font-medium text-right">Rollout</th>
                  <th className="px-4 py-3 font-medium">Stale Reason & Cleanup</th>
                  <th className="px-5 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filtered.map((r) => (
                  <tr key={`${r.flagId}-${r.environmentId}`}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{r.flagName}</div>
                      <div className="font-mono text-slate-500">{r.flagKey}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.projectName} · {r.environmentName}
                    </td>
                    <td className="px-4 py-3">{r.ownerName}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.daysSinceEvaluation !== null ? `${r.daysSinceEvaluation}d ago` : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.rolloutPercentage}%
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium text-amber-700 dark:text-amber-400">
                        {r.staleReason === 'NOT_EVALUATED_30D'
                          ? 'Not evaluated in ≥ 30 days'
                          : r.staleReason === 'FULL_ROLLOUT_14D'
                            ? `100% rolled out for ${r.daysAtFullRollout} days`
                            : 'Unused ≥ 30d & 100% ≥ 14d'}
                      </div>
                      <div className="text-slate-500 mt-0.5">{r.recommendation}</div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {user.role !== 'VIEWER' && (
                        <button
                          type="button"
                          onClick={() => void archiveFlag(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-400 font-medium"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>Archive</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
