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
import { ArrowRight, RefreshCw } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { NavPage } from '../components/Layout';
import type { ChangeRequest, SdkInstance } from '../types/flagship';

interface OverviewResponse {
  kpis: {
    totalProjects: number;
    totalFlags: number;
    enabledFlags: number;
    activeRollouts: number;
    pendingApprovals: number;
    connectedSdkInstances: number;
    staleFlagCount: number;
  };
  rolloutActivity: Array<{
    flagKey: string;
    flagName: string;
    dev: number;
    staging: number;
    prod: number;
  }>;
  recentChanges: Array<{
    id: string;
    flagId: string;
    flagKey: string;
    flagName: string;
    environmentName: string;
    version: number;
    authorName: string;
    reason: string;
    createdAt: string;
  }>;
  pendingApprovals: ChangeRequest[];
  sdkInstances: SdkInstance[];
}

interface DashboardOverviewProps {
  onNavigate: (page: NavPage) => void;
  onOpenFlag: (flagId: string) => void;
  refreshSignal: number;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  onNavigate,
  onOpenFlag,
  refreshSignal,
}) => {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<OverviewResponse>('/dashboard/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [refreshSignal]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-6">
        <p className="text-sm text-red-700 dark:text-red-300">{error || 'Unable to load dashboard'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 px-3.5 py-2 text-xs font-medium rounded-md bg-indigo-600 text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const kpiCards = [
    { label: 'Total Projects', value: data.kpis.totalProjects, target: 'projects' as NavPage },
    { label: 'Total Flags', value: data.kpis.totalFlags, target: 'flags' as NavPage },
    { label: 'Enabled in Prod', value: data.kpis.enabledFlags, target: 'flags' as NavPage },
    { label: 'Active Rollouts', value: data.kpis.activeRollouts, target: 'rollouts' as NavPage },
    { label: 'Pending Approvals', value: data.kpis.pendingApprovals, target: 'approvals' as NavPage, highlight: data.kpis.pendingApprovals > 0 },
    { label: 'Connected SDKs', value: data.kpis.connectedSdkInstances, target: 'health' as NavPage },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Release Control Overview
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Live feature rollouts, governance queues, and connected Spring Boot SDK nodes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => onNavigate(k.target)}
            className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{k.label}</div>
            <div
              className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
                k.highlight
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {k.value}
            </div>
          </button>
        ))}
      </div>

      {/* Rollout Activity Chart + Pending Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Rollout Activity by Environment (%)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Current sticky percentage rollout across Development, Staging, and Production.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('rollouts')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>Manage Rollouts</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.rolloutActivity} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis
                  dataKey="flagKey"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} unit="%" />
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
                <Bar dataKey="dev" name="Development" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="staging" name="Staging" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="prod" name="Production" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="lg:col-span-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Pending Production Approvals
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
            >
              Review All
            </button>
          </div>

          {data.pendingApprovals.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 py-8">
              All production change requests are reviewed.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.pendingApprovals.slice(0, 4).map((cr) => (
                <div key={cr.id} className="py-3 first:pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {cr.flagKey}
                    </span>
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
                      Pending
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                    {cr.reason}
                  </p>
                  <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {cr.authorName} · {cr.environmentName}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Changes + Connected SDKs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Recent Configuration Changes
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
            >
              Change History
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">Flag</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Env</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Ver</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Author</th>
                  <th className="px-5 py-2.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.recentChanges.map((ch) => (
                  <tr key={ch.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-2.5 font-mono text-xs whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenFlag(ch.flagId)}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        {ch.flagKey}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {ch.environmentName}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      v{ch.version}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {ch.authorName}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 dark:text-slate-400 max-w-[220px] truncate" title={ch.reason}>
                      {ch.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Connected SDK Instances
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('sdk')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              SDK Setup
            </button>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.sdkInstances.map((sdk) => (
              <div key={sdk.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium text-slate-900 dark:text-white truncate">
                    {sdk.instanceName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {sdk.transport} · {sdk.sdkVersion}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {sdk.status}
                  </div>
                  <div className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {sdk.lastSyncLatencyMs}ms sync
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
