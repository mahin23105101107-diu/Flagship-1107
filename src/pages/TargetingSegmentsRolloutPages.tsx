import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { apiRequest } from '../api/client';
import type {
  ConditionLeaf,
  Environment,
  FeatureFlag,
  FlagEnvironmentConfig,
  LogicalOperator,
  PublicUser,
  TargetingOperator,
  TargetingRule,
  UserSegment,
} from '../types/flagship';
import type { EnrichedFlag } from './FlagsPages';

const OPERATORS: TargetingOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'CONTAINS',
  'SEMVER_GREATER_THAN',
  'REGEX',
  'DATE_BEFORE',
  'DATE_AFTER',
];

interface TargetingPageProps {
  projectId: string;
  environmentId: string;
  environments: Environment[];
  selectedFlagId: string;
  onSelectFlagId: (id: string) => void;
  user: PublicUser;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  onRefresh: () => void;
  refreshSignal: number;
}

export const TargetingRulesPage: React.FC<TargetingPageProps> = ({
  projectId,
  environmentId,
  environments,
  selectedFlagId,
  onSelectFlagId,
  user,
  onNotify,
  onRefresh,
  refreshSignal,
}) => {
  const [flags, setFlags] = useState<EnrichedFlag[]>([]);
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [rules, setRules] = useState<TargetingRule[]>([]);
  const [targetUsersText, setTargetUsersText] = useState('');
  const [targetVarId, setTargetVarId] = useState('');
  const [reason, setReason] = useState('Updated targeting rules');
  const [saving, setSaving] = useState(false);

  const currentEnv = environments.find((e) => e.id === environmentId);

  useEffect(() => {
    const load = async () => {
      const [fRes, sRes] = await Promise.all([
        apiRequest<{ items: EnrichedFlag[] }>(
          `/flags?projectId=${projectId}&environmentId=${environmentId}&pageSize=50`,
        ),
        apiRequest<{ items: UserSegment[] }>(`/segments?projectId=${projectId}`),
      ]);
      setFlags(fRes.items);
      setSegments(sRes.items);

      const chosen = fRes.items.find((f) => f.id === selectedFlagId) ?? fRes.items[0];
      if (chosen) {
        if (chosen.id !== selectedFlagId) onSelectFlagId(chosen.id);
        const cfg = chosen.activeConfig;
        setRules(cfg ? structuredClone(cfg.targetingRules) : []);
        const firstTarget = cfg?.individualTargets[0];
        setTargetUsersText(firstTarget ? firstTarget.userKeys.join(', ') : '');
        setTargetVarId(firstTarget?.variationId ?? chosen.variations[0]?.id ?? '');
      }
    };
    void load();
  }, [projectId, environmentId, selectedFlagId, refreshSignal]);

  const currentFlag = flags.find((f) => f.id === selectedFlagId) ?? flags[0];

  const addRule = () => {
    if (!currentFlag) return;
    setRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}`,
        name: `Rule ${prev.length + 1}`,
        priority: prev.length + 1,
        segmentIds: [],
        serveVariationId: currentFlag.variations[0].id,
        enabled: true,
        rootGroup: {
          kind: 'group',
          id: `grp-${Date.now()}`,
          logicalOp: 'AND',
          children: [
            {
              kind: 'condition',
              id: `cond-${Date.now()}`,
              attribute: 'country',
              operator: 'IN',
              values: ['US', 'CA'],
            },
          ],
        },
      },
    ]);
  };

  const moveRule = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= rules.length) return;
    const clone = [...rules];
    const [moved] = clone.splice(index, 1);
    clone.splice(nextIdx, 0, moved);
    setRules(clone.map((r, i) => ({ ...r, priority: i + 1 })));
  };

  const addCondition = (ruleIdx: number) => {
    setRules((prev) =>
      prev.map((r, idx) =>
        idx === ruleIdx
          ? {
              ...r,
              rootGroup: {
                ...r.rootGroup,
                children: [
                  ...r.rootGroup.children,
                  {
                    kind: 'condition',
                    id: `cond-${Date.now()}`,
                    attribute: 'plan',
                    operator: 'EQUALS',
                    values: ['enterprise'],
                  },
                ],
              },
            }
          : r,
      ),
    );
  };

  const updateCondition = (
    ruleIdx: number,
    condIdx: number,
    patch: Partial<ConditionLeaf>,
  ) => {
    setRules((prev) =>
      prev.map((r, idx) => {
        if (idx !== ruleIdx) return r;
        const nextChildren = r.rootGroup.children.map((ch, cIdx) =>
          cIdx === condIdx && ch.kind === 'condition' ? { ...ch, ...patch } : ch,
        );
        return { ...r, rootGroup: { ...r.rootGroup, children: nextChildren } };
      }),
    );
  };

  const removeCondition = (ruleIdx: number, condIdx: number) => {
    setRules((prev) =>
      prev.map((r, idx) =>
        idx === ruleIdx
          ? {
              ...r,
              rootGroup: {
                ...r.rootGroup,
                children: r.rootGroup.children.filter((_, cIdx) => cIdx !== condIdx),
              },
            }
          : r,
      ),
    );
  };

  const saveTargeting = async () => {
    if (!currentFlag) return;
    setSaving(true);
    try {
      const userKeys = targetUsersText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const individualTargets =
        userKeys.length > 0 && targetVarId ? [{ variationId: targetVarId, userKeys }] : [];

      const res = await apiRequest<{ approvalRequired: boolean; changeRequest?: { id: string } }>(
        `/flags/${currentFlag.id}/config/${environmentId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            patch: { targetingRules: rules, individualTargets },
            reason,
          }),
        },
      );
      if (res.approvalRequired) {
        onNotify(
          'info',
          'Submitted for Production approval',
          `Change request ${res.changeRequest?.id} awaits Approver review.`,
        );
      } else {
        onNotify('success', 'Targeting rules saved', `${currentFlag.key} updated in ${currentEnv?.name}`);
      }
      onRefresh();
    } catch (err) {
      onNotify('error', 'Save failed', err instanceof Error ? err.message : 'Validation error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Targeting Rules
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Evaluation order: 1. Kill Switch → 2. Individual Targets → 3. Segment & Rule Groups → 4. Sticky Rollout → 5. Default.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Select flag to target"
            value={currentFlag?.id ?? ''}
            onChange={(e) => onSelectFlagId(e.target.value)}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono"
          >
            {flags.map((f) => (
              <option key={f.id} value={f.id}>
                {f.key}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stage 2: Individual User Targets */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Individual User Targets
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-8">
            <label htmlFor="ind-users" className="block text-xs text-slate-500 mb-1">
              User Keys (comma separated)
            </label>
            <input
              id="ind-users"
              value={targetUsersText}
              onChange={(e) => setTargetUsersText(e.target.value)}
              placeholder="alice@acme.io, vip-user-01"
              className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="ind-var" className="block text-xs text-slate-500 mb-1">
              Serve Variation
            </label>
            <select
              id="ind-var"
              value={targetVarId}
              onChange={(e) => setTargetVarId(e.target.value)}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              {currentFlag?.variations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({String(v.value)})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Stage 3: Priority Rules & Segment Conditions */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Segment & Attribute Rules ({rules.length})
          </h2>
          {user.role !== 'VIEWER' && (
            <button
              type="button"
              onClick={addRule}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Rule</span>
            </button>
          )}
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
            No attribute or segment rules defined. Traffic falls through directly to Sticky Percentage Rollout.
          </div>
        ) : (
          rules.map((rule, rIdx) => (
            <div
              key={rule.id}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <span className="font-mono text-xs text-slate-500 tabular-nums">#{rIdx + 1}</span>
                  <input
                    aria-label="Rule name"
                    value={rule.name}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item, i) => (i === rIdx ? { ...item, name: e.target.value } : item)),
                      )
                    }
                    className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-sm font-medium"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    aria-label="Logical operator"
                    value={rule.rootGroup.logicalOp}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item, i) =>
                          i === rIdx
                            ? {
                                ...item,
                                rootGroup: {
                                  ...item.rootGroup,
                                  logicalOp: e.target.value as LogicalOperator,
                                },
                              }
                            : item,
                        ),
                      )
                    }
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono"
                  >
                    <option value="AND">Match ALL (AND)</option>
                    <option value="OR">Match ANY (OR)</option>
                  </select>

                  <select
                    aria-label="Serve variation"
                    value={rule.serveVariationId}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item, i) =>
                          i === rIdx ? { ...item, serveVariationId: e.target.value } : item,
                        ),
                      )
                    }
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                  >
                    {currentFlag?.variations.map((v) => (
                      <option key={v.id} value={v.id}>
                        Serve: {v.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    aria-label="Move rule up"
                    onClick={() => moveRule(rIdx, -1)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move rule down"
                    onClick={() => moveRule(rIdx, 1)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => setRules((prev) => prev.filter((_, i) => i !== rIdx))}
                    className="p-1.5 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Segment Attachment */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-500 font-medium">Require Segment:</span>
                <select
                  aria-label="Attached segment"
                  value={rule.segmentIds[0] ?? ''}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((item, i) =>
                        i === rIdx
                          ? { ...item, segmentIds: e.target.value ? [e.target.value] : [] }
                          : item,
                      ),
                    )
                  }
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs"
                >
                  <option value="">None (attributes only)</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.key})
                    </option>
                  ))}
                </select>
              </div>

              {/* Conditions */}
              <div className="space-y-2">
                {rule.rootGroup.children.map((child, cIdx) => {
                  if (child.kind !== 'condition') return null;
                  return (
                    <div key={child.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <input
                        aria-label="Attribute"
                        value={child.attribute}
                        onChange={(e) => updateCondition(rIdx, cIdx, { attribute: e.target.value })}
                        placeholder="attribute (e.g. appVersion)"
                        className="sm:col-span-3 font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                      />
                      <select
                        aria-label="Operator"
                        value={child.operator}
                        onChange={(e) =>
                          updateCondition(rIdx, cIdx, {
                            operator: e.target.value as TargetingOperator,
                          })
                        }
                        className="sm:col-span-4 font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                      >
                        {OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Values"
                        value={child.values.join(', ')}
                        onChange={(e) =>
                          updateCondition(rIdx, cIdx, {
                            values: e.target.value.split(',').map((s) => s.trim()),
                          })
                        }
                        placeholder="comma-separated values"
                        className="sm:col-span-4 font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        aria-label="Delete condition"
                        onClick={() => removeCondition(rIdx, cIdx)}
                        className="sm:col-span-1 p-1.5 text-slate-400 hover:text-red-600 justify-self-end"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => addCondition(rIdx)}
                  className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  + Add attribute condition
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {user.role !== 'VIEWER' && currentFlag && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
          <input
            aria-label="Change reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for targeting update..."
            className="flex-1 min-w-[220px] rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveTargeting()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Save className="w-3.5 h-3.5" />
            <span>
              {saving
                ? 'Saving...'
                : currentEnv?.requiresApproval
                  ? 'Submit for Production Approval'
                  : 'Save Targeting Rules'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

interface SegmentsPageProps {
  projectId: string;
  user: PublicUser;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  refreshSignal: number;
}

export const UserSegmentsPage: React.FC<SegmentsPageProps> = ({
  projectId,
  user,
  onNotify,
  refreshSignal,
}) => {
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [included, setIncluded] = useState('');
  const [attr, setAttr] = useState('plan');
  const [op, setOp] = useState<TargetingOperator>('EQUALS');
  const [val, setVal] = useState('enterprise');

  const load = async () => {
    const res = await apiRequest<{ items: UserSegment[] }>(`/segments?projectId=${projectId}`);
    setSegments(res.items);
  };

  useEffect(() => {
    void load();
  }, [projectId, refreshSignal]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/segments', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          name,
          key,
          description,
          includedUsers: included
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          rootGroup: {
            kind: 'group',
            id: `sg-${Date.now()}`,
            logicalOp: 'AND',
            children: [
              {
                kind: 'condition',
                id: `sc-${Date.now()}`,
                attribute: attr,
                operator: op,
                values: val.split(',').map((s) => s.trim()),
              },
            ],
          },
        }),
      });
      setShowCreate(false);
      setName('');
      setKey('');
      setDescription('');
      setIncluded('');
      onNotify('success', 'Segment created', name);
      void load();
    } catch (err) {
      onNotify('error', 'Failed', err instanceof Error ? err.message : 'Error');
    }
  };

  const handleDelete = async (seg: UserSegment) => {
    try {
      await apiRequest(`/segments/${seg.id}`, { method: 'DELETE' });
      onNotify('info', 'Segment deleted', seg.name);
      void load();
    } catch (err) {
      onNotify('error', 'Delete failed', err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            User Segments
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Reusable cohorts evaluated across any flag targeting rule in this project.
          </p>
        </div>
        {user.role !== 'VIEWER' && (
          <button
            type="button"
            onClick={() => setShowCreate((s) => !s)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>New Segment</span>
          </button>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="seg-name" className="block text-xs text-slate-500 mb-1">
                Segment Name
              </label>
              <input
                id="seg-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!key) setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                }}
                placeholder="EU Power Users"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="seg-key" className="block text-xs text-slate-500 mb-1">
                Segment Key
              </label>
              <input
                id="seg-key"
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="eu-power-users"
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={attr}
              onChange={(e) => setAttr(e.target.value)}
              placeholder="Attribute"
              className="font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
            <select
              value={op}
              onChange={(e) => setOp(e.target.value as TargetingOperator)}
              className="font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <input
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="Value(s)"
              className="font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>
          <input
            value={included}
            onChange={(e) => setIncluded(e.target.value)}
            placeholder="Explicitly included user keys (comma separated)"
            className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs bg-indigo-600 text-white rounded-md font-medium">
              Create Segment
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {segments.map((seg) => (
          <div
            key={seg.id}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {seg.name}
                </h2>
                <div className="font-mono text-xs text-slate-500">{seg.key}</div>
              </div>
              {user.role !== 'VIEWER' && (
                <button
                  type="button"
                  aria-label={`Delete segment ${seg.name}`}
                  onClick={() => void handleDelete(seg)}
                  className="text-slate-400 hover:text-red-600 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">{seg.description}</p>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1 text-xs">
              <div className="font-medium text-slate-700 dark:text-slate-300">
                Logic: {seg.rootGroup.logicalOp} ({seg.rootGroup.children.length} conditions)
              </div>
              {seg.rootGroup.children.map((ch) =>
                ch.kind === 'condition' ? (
                  <div key={ch.id} className="font-mono text-slate-600 dark:text-slate-400">
                    {ch.attribute} {ch.operator} [{ch.values.join(', ')}]
                  </div>
                ) : null,
              )}
              {seg.includedUsers.length > 0 && (
                <div className="text-slate-500 pt-1">
                  Included: <span className="font-mono">{seg.includedUsers.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface RolloutPageProps {
  projectId: string;
  environmentId: string;
  environments: Environment[];
  selectedFlagId: string;
  onSelectFlagId: (id: string) => void;
  user: PublicUser;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  onRefresh: () => void;
  refreshSignal: number;
}

export const RolloutManagementPage: React.FC<RolloutPageProps> = ({
  projectId,
  environmentId,
  environments,
  selectedFlagId,
  onSelectFlagId,
  user,
  onNotify,
  onRefresh,
  refreshSignal,
}) => {
  const [flags, setFlags] = useState<EnrichedFlag[]>([]);
  const [percentage, setPercentage] = useState(25);
  const [rolloutVarId, setRolloutVarId] = useState('');
  const [reason, setReason] = useState('Adjusted sticky rollout percentage');
  const [simData, setSimData] = useState<{
    observedPercentage: number;
    deciles: Array<{ range: string; inRollout: number; defaultCount: number }>;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const currentEnv = environments.find((e) => e.id === environmentId);

  useEffect(() => {
    const load = async () => {
      const res = await apiRequest<{ items: EnrichedFlag[] }>(
        `/flags?projectId=${projectId}&environmentId=${environmentId}&pageSize=50`,
      );
      setFlags(res.items);
      const chosen = res.items.find((f) => f.id === selectedFlagId) ?? res.items[0];
      if (chosen) {
        if (chosen.id !== selectedFlagId) onSelectFlagId(chosen.id);
        setPercentage(chosen.activeConfig?.rolloutPercentage ?? 0);
        setRolloutVarId(chosen.activeConfig?.rolloutVariationId ?? chosen.variations[0]?.id ?? '');
      }
    };
    void load();
  }, [projectId, environmentId, selectedFlagId, refreshSignal]);

  const currentFlag = flags.find((f) => f.id === selectedFlagId) ?? flags[0];

  useEffect(() => {
    if (!currentFlag) return;
    const simulate = async () => {
      const res = await apiRequest<{
        observedPercentage: number;
        deciles: Array<{ range: string; inRollout: number; defaultCount: number }>;
      }>('/rollouts/simulate', {
        method: 'POST',
        body: JSON.stringify({
          flagKey: currentFlag.key,
          rolloutPercentage: percentage,
          sampleSize: 5000,
        }),
      });
      setSimData(res);
    };
    void simulate();
  }, [currentFlag?.key, percentage]);

  const saveRollout = async () => {
    if (!currentFlag) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ approvalRequired: boolean; changeRequest?: { id: string } }>(
        `/flags/${currentFlag.id}/config/${environmentId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            patch: {
              rolloutPercentage: percentage,
              rolloutVariationId: rolloutVarId,
              rolloutWeights: [],
            },
            reason,
          }),
        },
      );
      if (res.approvalRequired) {
        onNotify(
          'info',
          'Production approval requested',
          `Change request ${res.changeRequest?.id} created (${percentage}% rollout).`,
        );
      } else {
        onNotify('success', 'Rollout updated', `${currentFlag.key} set to ${percentage}% in ${currentEnv?.name}.`);
      }
      onRefresh();
    } catch (err) {
      onNotify('error', 'Save failed', err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Sticky Rollout Management
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Deterministic MurmurHash3 bucketing over <code className="font-mono">flagKey:userKey</code>. Expanding from 10% to 20% preserves 100% of the initial cohort.
          </p>
        </div>

        <select
          aria-label="Select flag for rollout"
          value={currentFlag?.id ?? ''}
          onChange={(e) => onSelectFlagId(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono"
        >
          {flags.map((f) => (
            <option key={f.id} value={f.id}>
              {f.key}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="rollout-slider" className="text-sm font-medium text-slate-900 dark:text-white">
                Rollout Percentage ({currentEnv?.name})
              </label>
              <span className="font-mono text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {percentage}%
              </span>
            </div>
            <input
              id="rollout-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={percentage}
              onChange={(e) => setPercentage(Number(e.target.value))}
              className="w-full mt-3 accent-indigo-600"
            />
            <div className="flex items-center justify-between mt-2 gap-1.5">
              {[0, 10, 25, 50, 75, 100].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPercentage(preset)}
                  className={`flex-1 py-1 text-xs font-mono rounded border ${
                    percentage === preset
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="rollout-var" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Target Variation for Rollout Cohort
            </label>
            <select
              id="rollout-var"
              value={rolloutVarId}
              onChange={(e) => setRolloutVarId(e.target.value)}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              {currentFlag?.variations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({String(v.value)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rollout-reason" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Change Reason
            </label>
            <input
              id="rollout-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </div>

          {user.role !== 'VIEWER' && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveRollout()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {saving
                  ? 'Submitting...'
                  : currentEnv?.requiresApproval
                    ? 'Submit Production Rollout Request'
                    : 'Apply Rollout Now'}
              </span>
            </button>
          )}
        </div>

        {/* Simulated 5,000-User Bucket Distribution Chart */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Deterministic Bucket Distribution (5,000 Simulated Users)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Observed rollout cohort:{' '}
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {simData?.observedPercentage ?? 0}%
                </span>{' '}
                (Target: {percentage}%)
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={simData?.deciles ?? []} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="inRollout" name="In Rollout Cohort" stackId="a" fill="#4f46e5" />
                <Bar dataKey="defaultCount" name="Default Variation" stackId="a" fill="#cbd5e1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
