import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Archive,
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
  Search,
  Sliders,
  Target,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import type { NavPage } from '../components/Layout';
import type {
  Environment,
  EvaluationResult,
  FeatureFlag,
  FlagEnvironmentConfig,
  FlagType,
  PublicUser,
} from '../types/flagship';

export interface EnrichedFlag extends FeatureFlag {
  ownerName: string;
  configs: FlagEnvironmentConfig[];
  activeConfig?: FlagEnvironmentConfig;
}

interface FlagsListPageProps {
  projectId: string;
  environmentId: string;
  environments: Environment[];
  user: PublicUser;
  refreshSignal: number;
  onOpenFlag: (flagId: string) => void;
  onNavigate: (page: NavPage) => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  onRefresh: () => void;
}

export const FlagsListPage: React.FC<FlagsListPageProps> = ({
  projectId,
  environmentId,
  environments,
  user,
  refreshSignal,
  onOpenFlag,
  onNavigate,
  onNotify,
  onRefresh,
}) => {
  const [items, setItems] = useState<EnrichedFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const currentEnv = environments.find((e) => e.id === environmentId);

  const loadFlags = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        projectId,
        environmentId,
        type: typeFilter,
        includeArchived: String(includeArchived),
        page: String(page),
        pageSize: '10',
      });
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiRequest<{ items: EnrichedFlag[]; total: number; totalPages: number }>(
        `/flags?${qs.toString()}`,
      );
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      onNotify('error', 'Load failed', err instanceof Error ? err.message : 'Unable to load flags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFlags();
  }, [projectId, environmentId, typeFilter, includeArchived, page, search, refreshSignal]);

  const toggleEnabled = async (flag: EnrichedFlag) => {
    const cfg = flag.activeConfig;
    if (!cfg) return;
    try {
      const res = await apiRequest<{ approvalRequired: boolean; changeRequest?: { id: string } }>(
        `/flags/${flag.id}/config/${environmentId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            patch: { enabled: !cfg.enabled },
            reason: `${!cfg.enabled ? 'Enable' : 'Disable'} ${flag.key} in ${currentEnv?.name ?? 'environment'}`,
          }),
        },
      );
      if (res.approvalRequired) {
        onNotify(
          'info',
          'Production approval required',
          `Submitted change request ${res.changeRequest?.id} for Approver review.`,
        );
      } else {
        onNotify('success', 'Flag updated', `${flag.key} is now ${!cfg.enabled ? 'Enabled' : 'Disabled'}.`);
      }
      onRefresh();
      void loadFlags();
    } catch (err) {
      onNotify('error', 'Update blocked', err instanceof Error ? err.message : 'Unable to update flag');
    }
  };

  const toggleKillSwitch = async (flag: EnrichedFlag) => {
    const cfg = flag.activeConfig;
    if (!cfg) return;
    try {
      await apiRequest(`/flags/${flag.id}/kill-switch/${environmentId}`, {
        method: 'POST',
        body: JSON.stringify({ active: !cfg.killSwitchActive }),
      });
      onNotify(
        cfg.killSwitchActive ? 'info' : 'error',
        cfg.killSwitchActive ? 'Kill switch released' : 'Kill switch activated',
        `${flag.key} pushed to connected SDKs via SSE.`,
      );
      onRefresh();
      void loadFlags();
    } catch (err) {
      onNotify('error', 'Kill switch failed', err instanceof Error ? err.message : 'Error');
    }
  };

  const toggleArchive = async (flag: EnrichedFlag) => {
    try {
      await apiRequest(`/flags/${flag.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !flag.archived }),
      });
      onNotify('info', flag.archived ? 'Flag restored' : 'Flag archived', flag.key);
      onRefresh();
      void loadFlags();
    } catch (err) {
      onNotify('error', 'Archive failed', err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Feature Flags
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            {currentEnv?.name ?? 'Environment'} · {total} flags configured
            {currentEnv?.requiresApproval ? ' · Production changes require approval' : ''}
          </p>
        </div>
        {user.role !== 'VIEWER' && (
          <button
            type="button"
            onClick={() => onNavigate('create-flag')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Create Flag</span>
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search feature flags"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by key, name, description, or tag..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-md bg-slate-100 dark:bg-slate-800">
            {(['ALL', 'BOOLEAN', 'STRING', 'NUMBER', 'JSON'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTypeFilter(t);
                  setPage(1);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  typeFilter === t
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t === 'ALL' ? 'All' : t}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 px-2">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Flags Table */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-11 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-white">No feature flags match your filters</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Clear your search filter or create a new feature flag for this project.
            </p>
            {user.role !== 'VIEWER' && (
              <button
                type="button"
                onClick={() => onNavigate('create-flag')}
                className="mt-4 px-4 py-2 rounded-md bg-indigo-600 text-white text-xs font-medium"
              >
                Create First Flag
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-5 py-3 font-medium">Flag & Key</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">State ({currentEnv?.name})</th>
                  <th className="px-4 py-3 font-medium text-right">Rollout</th>
                  <th className="px-4 py-3 font-medium text-right">Rules</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-5 py-3 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((flag) => {
                  const cfg = flag.activeConfig;
                  const stateLabel = cfg?.killSwitchActive
                    ? 'Kill Switch Active'
                    : cfg?.enabled
                      ? 'Enabled'
                      : 'Disabled';
                  const stateColor = cfg?.killSwitchActive
                    ? 'text-red-600 dark:text-red-400'
                    : cfg?.enabled
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400';

                  return (
                    <tr key={flag.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => onOpenFlag(flag.id)}
                          className="font-medium text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 text-left"
                        >
                          {flag.name}
                        </button>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {flag.key}
                          {flag.archived ? ' · Archived' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {flag.type}
                      </td>
                      <td className={`px-4 py-3 text-xs font-medium ${stateColor}`}>
                        {stateLabel}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                        {cfg ? `${cfg.rolloutPercentage}%` : '0%'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
                        {cfg?.targetingRules.length ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {flag.ownerName}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {user.role !== 'VIEWER' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void toggleEnabled(flag)}
                                className="px-2.5 py-1 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {cfg?.enabled ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleKillSwitch(flag)}
                                title="Emergency kill switch (instant SSE propagation)"
                                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                                  cfg?.killSwitchActive
                                    ? 'border-red-300 bg-red-600 text-white hover:bg-red-700'
                                    : 'border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                                }`}
                              >
                                {cfg?.killSwitchActive ? 'Release Kill' : 'Kill Switch'}
                              </button>
                              <button
                                type="button"
                                aria-label={`Archive ${flag.key}`}
                                onClick={() => void toggleArchive(flag)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface CreateFlagPageProps {
  projectId: string;
  onCreated: (flagId: string) => void;
  onCancel: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const CreateFlagPage: React.FC<CreateFlagPageProps> = ({
  projectId,
  onCreated,
  onCancel,
  onNotify,
}) => {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<FlagType>('BOOLEAN');
  const [tagsText, setTagsText] = useState('');
  const [varAName, setVarAName] = useState('Enabled');
  const [varAVal, setVarAVal] = useState('true');
  const [varBName, setVarBName] = useState('Disabled');
  const [varBVal, setVarBVal] = useState('false');
  const [submitting, setSubmitting] = useState(false);

  const handleTypeChange = (next: FlagType) => {
    setType(next);
    if (next === 'BOOLEAN') {
      setVarAName('Enabled');
      setVarAVal('true');
      setVarBName('Disabled');
      setVarBVal('false');
    } else if (next === 'STRING') {
      setVarAName('Treatment Variant');
      setVarAVal('variant-a');
      setVarBName('Control Variant');
      setVarBVal('control');
    } else if (next === 'NUMBER') {
      setVarAName('High Limit');
      setVarAVal('500');
      setVarBName('Standard Limit');
      setVarBVal('100');
    } else {
      setVarAName('New Config');
      setVarAVal('{"maxRetries": 5, "fastPath": true}');
      setVarBName('Default Config');
      setVarBVal('{"maxRetries": 2, "fastPath": false}');
    }
  };

  const parseValue = (raw: string): boolean | string | number | Record<string, unknown> => {
    if (type === 'BOOLEAN') return raw === 'true';
    if (type === 'NUMBER') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${raw}`);
      return n;
    }
    if (type === 'JSON') {
      return JSON.parse(raw) as Record<string, unknown>;
    }
    return raw;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const variations = [
        { id: `v-${Date.now()}-a`, key: 'variation-a', name: varAName, value: parseValue(varAVal) },
        { id: `v-${Date.now()}-b`, key: 'variation-b', name: varBName, value: parseValue(varBVal) },
      ];
      const res = await apiRequest<{ flag: FeatureFlag }>('/flags', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          name,
          key,
          description,
          type,
          variations,
          defaultVariationId: variations[1].id,
          tags: tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      onNotify('success', 'Feature flag created', `${res.flag.key} is ready across all environments.`);
      onCreated(res.flag.id);
    } catch (err) {
      onNotify('error', 'Validation error', err instanceof Error ? err.message : 'Check flag fields');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Create Feature Flag
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Define flag metadata, value type, and named variations. Environment configs are provisioned automatically.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="flag-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Flag Name
            </label>
            <input
              id="flag-name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!key) {
                  setKey(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, ''),
                  );
                }
              }}
              placeholder="Smart Search Ranking"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="flag-key" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Unique Flag Key
            </label>
            <input
              id="flag-key"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="smart-search-ranking"
              className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="flag-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Description
          </label>
          <textarea
            id="flag-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what behavior this flag guards and cleanup criteria."
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="flag-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Flag Type
            </label>
            <select
              id="flag-type"
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as FlagType)}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="BOOLEAN">BOOLEAN (true / false)</option>
              <option value="STRING">STRING (multivariate labels)</option>
              <option value="NUMBER">NUMBER (thresholds & limits)</option>
              <option value="JSON">JSON (structured config payload)</option>
            </select>
          </div>
          <div>
            <label htmlFor="flag-tags" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tags (comma separated)
            </label>
            <input
              id="flag-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="search, experiment"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Named Variations
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="var-a-name" className="block text-xs text-slate-500">
                Rollout Variation Name
              </label>
              <input
                id="var-a-name"
                required
                value={varAName}
                onChange={(e) => setVarAName(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
              />
              <label htmlFor="var-a-val" className="block text-xs text-slate-500">
                Value ({type})
              </label>
              <input
                id="var-a-val"
                required
                value={varAVal}
                onChange={(e) => setVarAVal(e.target.value)}
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="var-b-name" className="block text-xs text-slate-500">
                Default / Fallback Variation Name
              </label>
              <input
                id="var-b-name"
                required
                value={varBName}
                onChange={(e) => setVarBName(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
              />
              <label htmlFor="var-b-val" className="block text-xs text-slate-500">
                Default Value ({type})
              </label>
              <input
                id="var-b-val"
                required
                value={varBVal}
                onChange={(e) => setVarBVal(e.target.value)}
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            {submitting ? 'Creating...' : 'Create Flag'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface FlagDetailsPageProps {
  flagId: string;
  environmentId: string;
  onSelectEnv: (envId: string) => void;
  onNavigate: (page: NavPage) => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  onRefresh: () => void;
  user: PublicUser;
}

export const FlagDetailsPage: React.FC<FlagDetailsPageProps> = ({
  flagId,
  environmentId,
  onSelectEnv,
  onNavigate,
  onNotify,
  onRefresh,
  user,
}) => {
  const [flag, setFlag] = useState<(FeatureFlag & { ownerName: string }) | null>(null);
  const [configs, setConfigs] = useState<FlagEnvironmentConfig[]>([]);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);

  // Evaluation Playground State
  const [testUserKey, setTestUserKey] = useState('alice@acme.io');
  const [testAttrsJson, setTestAttrsJson] = useState(
    JSON.stringify({ plan: 'enterprise', appVersion: '2.4.0', country: 'US', email: 'alice@flagship.io' }, null, 2),
  );
  const [evalOutput, setEvalOutput] = useState<{ result: EvaluationResult; bucket: number } | null>(null);

  const loadDetail = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        flag: FeatureFlag & { ownerName: string };
        configs: FlagEnvironmentConfig[];
        environments: Environment[];
      }>(`/flags/${flagId}`);
      setFlag(res.flag);
      setConfigs(res.configs);
      setEnvs(res.environments);
    } catch (err) {
      onNotify('error', 'Failed to load flag', err instanceof Error ? err.message : 'Not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (flagId) void loadDetail();
  }, [flagId]);

  const activeConfig = configs.find((c) => c.environmentId === environmentId) ?? configs[0];
  const activeEnv = envs.find((e) => e.id === activeConfig?.environmentId);

  const runPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flag || !activeConfig) return;
    try {
      const attributes = JSON.parse(testAttrsJson) as Record<string, unknown>;
      const res = await apiRequest<{ result: EvaluationResult; bucket: number }>(
        `/flags/${flag.id}/evaluate`,
        {
          method: 'POST',
          body: JSON.stringify({
            environmentId: activeConfig.environmentId,
            userKey: testUserKey,
            attributes,
          }),
        },
      );
      setEvalOutput(res);
    } catch (err) {
      onNotify('error', 'Evaluation error', err instanceof Error ? err.message : 'Invalid JSON attributes');
    }
  };

  const toggleKill = async () => {
    if (!flag || !activeConfig) return;
    try {
      await apiRequest(`/flags/${flag.id}/kill-switch/${activeConfig.environmentId}`, {
        method: 'POST',
        body: JSON.stringify({ active: !activeConfig.killSwitchActive }),
      });
      onNotify(
        activeConfig.killSwitchActive ? 'info' : 'error',
        activeConfig.killSwitchActive ? 'Kill switch deactivated' : 'Emergency kill switch active',
        `${flag.key} (${activeEnv?.name})`,
      );
      onRefresh();
      void loadDetail();
    } catch (err) {
      onNotify('error', 'Error', err instanceof Error ? err.message : 'Failed');
    }
  };

  if (loading || !flag || !activeConfig) {
    return <div className="h-64 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <button type="button" onClick={() => onNavigate('flags')} className="hover:underline">
              Feature Flags
            </button>
            <span>/</span>
            <span className="font-mono">{flag.key}</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {flag.name}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{flag.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('targeting')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Target className="w-3.5 h-3.5" />
            <span>Targeting Rules</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('rollouts')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Rollout</span>
          </button>
          {user.role !== 'VIEWER' && (
            <button
              type="button"
              onClick={() => void toggleKill()}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md ${
                activeConfig.killSwitchActive
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>{activeConfig.killSwitchActive ? 'Release Kill Switch' : 'Activate Kill Switch'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Environment Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
        {envs.map((env) => (
          <button
            key={env.id}
            type="button"
            onClick={() => onSelectEnv(env.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              env.id === activeConfig.environmentId
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {env.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Configuration & Variations */}
        <div className="lg:col-span-6 space-y-6">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-4">
              {activeEnv?.name} Configuration Summary
            </h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Flag Status</dt>
                <dd className="mt-1 font-medium text-slate-900 dark:text-white">
                  {activeConfig.killSwitchActive
                    ? 'Kill Switch Active'
                    : activeConfig.enabled
                      ? 'Enabled'
                      : 'Disabled'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Sticky Rollout</dt>
                <dd className="mt-1 font-mono tabular-nums font-medium text-slate-900 dark:text-white">
                  {activeConfig.rolloutPercentage}%
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Config Version</dt>
                <dd className="mt-1 font-mono tabular-nums text-slate-900 dark:text-white">
                  v{activeConfig.version}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Targeting Rules</dt>
                <dd className="mt-1 font-mono tabular-nums text-slate-900 dark:text-white">
                  {activeConfig.targetingRules.length} rules ·{' '}
                  {activeConfig.individualTargets.reduce((a, t) => a + t.userKeys.length, 0)} targets
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-3">
              Variations ({flag.type})
            </h2>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {flag.variations.map((v) => (
                <div key={v.id} className="py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {v.name}
                      {v.id === flag.defaultVariationId && (
                        <span className="ml-2 text-xs font-normal text-slate-500">(Default)</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-slate-500">{v.key}</div>
                  </div>
                  <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-800 dark:text-slate-200 max-w-xs truncate">
                    {typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value)}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live Deterministic Evaluation Playground */}
        <div className="lg:col-span-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Live Evaluation Preview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-4">
            Executes the exact 5-stage Chain of Responsibility & MurmurHash3 bucketing engine used by the SDK.
          </p>

          <form onSubmit={runPreview} className="space-y-3">
            <div>
              <label htmlFor="eval-user-key" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                User Key
              </label>
              <input
                id="eval-user-key"
                required
                value={testUserKey}
                onChange={(e) => setTestUserKey(e.target.value)}
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label htmlFor="eval-attrs" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                User Attributes (JSON)
              </label>
              <textarea
                id="eval-attrs"
                rows={5}
                value={testAttrsJson}
                onChange={(e) => setTestAttrsJson(e.target.value)}
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Evaluate Context</span>
            </button>
          </form>

          {evalOutput && (
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Served Value</span>
                <code className="font-mono font-semibold text-indigo-700 dark:text-indigo-400">
                  {JSON.stringify(evalOutput.result.value)}
                </code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Match Reason</span>
                <span className="font-mono text-slate-900 dark:text-white">{evalOutput.result.reason}</span>
              </div>
              {evalOutput.result.matchedRuleName && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Matched Rule</span>
                  <span className="text-slate-900 dark:text-white">{evalOutput.result.matchedRuleName}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-500">MurmurHash3 Bucket</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                  {evalOutput.bucket.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Evaluation Latency</span>
                <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {evalOutput.result.evaluationTimeMicros} µs
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
