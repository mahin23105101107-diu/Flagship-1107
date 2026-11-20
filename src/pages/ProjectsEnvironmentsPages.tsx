import React, { useState } from 'react';
import { Copy, KeyRound, Plus, Shield, Trash2 } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { Environment, Project, PublicUser } from '../types/flagship';

interface ProjectsPageProps {
  projects: Array<Project & { environmentCount?: number; flagCount?: number; memberCount?: number }>;
  user: PublicUser;
  onRefresh: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  onSelectProject: (id: string) => void;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({
  projects,
  user,
  onRefresh,
  onNotify,
  onSelectProject,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, key, description }),
      });
      setName('');
      setKey('');
      setDescription('');
      setShowCreate(false);
      onNotify('success', 'Project created', 'Development, Staging, and Production environments provisioned.');
      onRefresh();
    } catch (err) {
      onNotify('error', 'Create failed', err instanceof Error ? err.message : 'Unable to create project');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleArchive = async (p: Project) => {
    try {
      await apiRequest(`/projects/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !p.archived }),
      });
      onNotify('info', p.archived ? 'Project restored' : 'Project archived', p.name);
      onRefresh();
    } catch (err) {
      onNotify('error', 'Action failed', err instanceof Error ? err.message : 'Could not update project');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Projects</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Isolate feature flags, user segments, and environments by product domain.
          </p>
        </div>
        {user.role !== 'VIEWER' && (
          <button
            type="button"
            onClick={() => setShowCreate((s) => !s)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Create Project
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="proj-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Project Name
              </label>
              <input
                id="proj-name"
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
                placeholder="Payments Platform"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="proj-key" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Project Key
              </label>
              <input
                id="proj-key"
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="payments-platform"
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label htmlFor="proj-desc" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Description
            </label>
            <input
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Billing engine, subscription tiers, and payout flows."
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
            >
              {submitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium text-right">Environments</th>
                <th className="px-4 py-3 font-medium text-right">Flags</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => onSelectProject(p.id)}
                      className="font-medium text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 text-left"
                    >
                      {p.name}
                    </button>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{p.description}</div>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {p.key}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-xs">
                    {p.environmentCount ?? 3}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-xs">
                    {p.flagCount ?? 0}
                  </td>
                  <td className="px-4 py-3.5 text-xs font-medium">
                    <span className={p.archived ? 'text-slate-500' : 'text-emerald-700 dark:text-emerald-400'}>
                      {p.archived ? 'Archived' : 'Active'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {user.role !== 'VIEWER' && (
                      <button
                        type="button"
                        onClick={() => void toggleArchive(p)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{p.archived ? 'Restore' : 'Archive'}</span>
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

interface EnvironmentsPageProps {
  environments: Environment[];
  selectedProjectId: string;
  user: PublicUser;
  onRefresh: () => void;
  onNotify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const EnvironmentsPage: React.FC<EnvironmentsPageProps> = ({
  environments,
  selectedProjectId,
  user,
  onRefresh,
  onNotify,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<Environment['type']>('STAGING');
  const [requiresApproval, setRequiresApproval] = useState(false);

  const projectEnvs = environments.filter((e) => e.projectId === selectedProjectId);

  const copyKey = async (sdkKey: string) => {
    try {
      await navigator.clipboard.writeText(sdkKey);
      onNotify('info', 'SDK key copied', sdkKey);
    } catch {
      onNotify('info', 'SDK key', sdkKey);
    }
  };

  const toggleApproval = async (env: Environment) => {
    try {
      await apiRequest(`/environments/${env.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ requiresApproval: !env.requiresApproval }),
      });
      onNotify(
        'success',
        'Approval policy updated',
        `${env.name}: ${!env.requiresApproval ? 'Approval Required' : 'Direct Changes Allowed'}`,
      );
      onRefresh();
    } catch (err) {
      onNotify('error', 'Update failed', err instanceof Error ? err.message : 'Admin role required');
    }
  };

  const rotateKey = async (env: Environment) => {
    try {
      await apiRequest(`/environments/${env.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ rotateSdkKey: true }),
      });
      onNotify('success', 'SDK key rotated', `Generated fresh SDK key for ${env.name}`);
      onRefresh();
    } catch (err) {
      onNotify('error', 'Rotation failed', err instanceof Error ? err.message : 'Admin role required');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/environments', {
        method: 'POST',
        body: JSON.stringify({ projectId: selectedProjectId, name, key, type, requiresApproval }),
      });
      setShowAdd(false);
      setName('');
      setKey('');
      onNotify('success', 'Environment created', `${name} added to project`);
      onRefresh();
    } catch (err) {
      onNotify('error', 'Failed', err instanceof Error ? err.message : 'Admin role required');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Environments
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Manage isolated SDK keys and production approval enforcement per environment.
          </p>
        </div>
        {user.role === 'ADMIN' && (
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Add Environment</span>
          </button>
        )}
      </div>

      {showAdd && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="env-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Name
              </label>
              <input
                id="env-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!key) setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                }}
                placeholder="QA Sandbox"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="env-key" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Key
              </label>
              <input
                id="env-key"
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="qa-sandbox"
                className="w-full font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="env-type" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Tier
              </label>
              <select
                id="env-type"
                value={type}
                onChange={(e) => setType(e.target.value as Environment['type'])}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="DEVELOPMENT">Development</option>
                <option value="STAGING">Staging</option>
                <option value="PRODUCTION">Production</option>
              </select>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="rounded border-slate-300"
            />
            Require Approver/Admin review before changes activate
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-md"
            >
              Create
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {projectEnvs.map((env) => (
          <div
            key={env.id}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {env.name}
                </h2>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {env.type}
                </span>
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">SDK Key</div>
                <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2">
                  <code className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate">
                    {env.sdkKey}
                  </code>
                  <button
                    type="button"
                    aria-label={`Copy SDK key for ${env.name}`}
                    onClick={() => void copyKey(env.sdkKey)}
                    className="text-slate-500 hover:text-indigo-600 shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">Approval Workflow</span>
                <span
                  className={`font-medium ${
                    env.requiresApproval
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {env.requiresApproval ? 'Required' : 'Direct Apply'}
                </span>
              </div>
            </div>

            {user.role === 'ADMIN' && (
              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleApproval(env)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>{env.requiresApproval ? 'Disable Gate' : 'Enable Gate'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void rotateKey(env)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Rotate</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
