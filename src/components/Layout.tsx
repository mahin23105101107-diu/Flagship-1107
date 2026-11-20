import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Code2,
  Flag,
  FolderKanban,
  GitBranch,
  HeartPulse,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Target,
  Users,
  X,
} from 'lucide-react';
import type { Environment, Project, PublicUser } from '../types/flagship';

export type NavPage =
  | 'dashboard'
  | 'projects'
  | 'environments'
  | 'flags'
  | 'create-flag'
  | 'flag-details'
  | 'targeting'
  | 'segments'
  | 'rollouts'
  | 'history'
  | 'approvals'
  | 'analytics'
  | 'hygiene'
  | 'team'
  | 'sdk'
  | 'health'
  | 'settings';

export interface ToastMessage {
  id: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface LayoutProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  user: PublicUser;
  onLogout: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  environments: Environment[];
  selectedEnvId: string;
  onSelectEnv: (id: string) => void;
  pendingApprovalCount: number;
  staleFlagCount: number;
  sseConnected: boolean;
  toasts: ToastMessage[];
  onDismissToast: (id: string) => void;
  children: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: Array<{ id: NavPage; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }>;
}

const PAGE_TITLES: Record<NavPage, { section: string; title: string }> = {
  dashboard: { section: 'Overview', title: 'Dashboard' },
  projects: { section: 'Workspace', title: 'Projects' },
  environments: { section: 'Workspace', title: 'Environments' },
  flags: { section: 'Delivery', title: 'Feature Flags' },
  'create-flag': { section: 'Delivery', title: 'Create Feature Flag' },
  'flag-details': { section: 'Delivery', title: 'Flag Details' },
  targeting: { section: 'Delivery', title: 'Targeting Rules' },
  segments: { section: 'Delivery', title: 'User Segments' },
  rollouts: { section: 'Delivery', title: 'Rollout Management' },
  history: { section: 'Governance', title: 'Change History' },
  approvals: { section: 'Governance', title: 'Approval Center' },
  analytics: { section: 'Insights', title: 'Experiment Analytics' },
  hygiene: { section: 'Insights', title: 'Flag Hygiene' },
  team: { section: 'Platform', title: 'Team Members & Roles' },
  sdk: { section: 'Platform', title: 'SDK Setup & Simulator' },
  health: { section: 'Platform', title: 'System Health' },
  settings: { section: 'Platform', title: 'Settings' },
};

export const Layout: React.FC<LayoutProps> = ({
  activePage,
  onNavigate,
  user,
  onLogout,
  darkMode,
  onToggleDarkMode,
  projects,
  selectedProjectId,
  onSelectProject,
  environments,
  selectedEnvId,
  onSelectEnv,
  pendingApprovalCount,
  staleFlagCount,
  sseConnected,
  toasts,
  onDismissToast,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navGroups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'projects', label: 'Projects', icon: FolderKanban },
        { id: 'environments', label: 'Environments', icon: Layers },
      ],
    },
    {
      label: 'Release Control',
      items: [
        { id: 'flags', label: 'Feature Flags', icon: Flag },
        { id: 'targeting', label: 'Targeting Rules', icon: Target },
        { id: 'segments', label: 'User Segments', icon: GitBranch },
        { id: 'rollouts', label: 'Rollout Management', icon: Sliders },
      ],
    },
    {
      label: 'Governance',
      items: [
        { id: 'approvals', label: 'Approval Center', icon: ShieldCheck, badge: pendingApprovalCount },
        { id: 'history', label: 'Change History', icon: History },
      ],
    },
    {
      label: 'Insights',
      items: [
        { id: 'analytics', label: 'Experiment Analytics', icon: BarChart3 },
        { id: 'hygiene', label: 'Flag Hygiene', icon: Sparkles, badge: staleFlagCount },
      ],
    },
    {
      label: 'Platform',
      items: [
        { id: 'sdk', label: 'SDK Setup', icon: Code2 },
        { id: 'team', label: 'Team & Roles', icon: Users },
        { id: 'health', label: 'System Health', icon: HeartPulse },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const pageMeta = PAGE_TITLES[activePage];
  const projectEnvs = environments.filter((e) => e.projectId === selectedProjectId);

  const handleNavClick = (page: NavPage) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between h-14 px-5 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => handleNavClick('dashboard')}
          className="flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white font-display font-bold text-sm">
            F
          </span>
          <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            FlagShip
          </span>
        </button>
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-3 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
        <div>
          <label htmlFor="sidebar-project-select" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Project
          </label>
          <select
            id="sidebar-project-select"
            value={selectedProjectId}
            onChange={(e) => onSelectProject(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {projects.filter((p) => !p.archived).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="sidebar-env-select" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Environment
          </label>
          <select
            id="sidebar-env-select"
            value={selectedEnvId}
            onChange={(e) => onSelectEnv(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {projectEnvs.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name} {env.requiresApproval ? '(Protected)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2.5 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  activePage === item.id ||
                  (item.id === 'flags' && (activePage === 'create-flag' || activePage === 'flag-details'));
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {typeof item.badge === 'number' && item.badge > 0 && (
                        <span className="text-xs font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {user.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {user.role} · {user.email}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
            className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 max-w-[80vw] h-full">{sidebarContent}</div>
          <button
            type="button"
            aria-label="Close backdrop"
            className="flex-1 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap">
                {pageMeta.section}
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <span className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {pageMeta.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              <Activity className={`w-3.5 h-3.5 ${sseConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'}`} />
              <span>{sseConnected ? 'SSE Live' : 'Reconnecting'}</span>
            </span>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {user.role !== 'VIEWER' && (
              <button
                type="button"
                onClick={() => onNavigate('create-flag')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Flag</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border p-3.5 shadow-lg bg-white dark:bg-slate-900 flex items-start justify-between gap-3 ${
                t.tone === 'error'
                  ? 'border-red-300 dark:border-red-800'
                  : t.tone === 'success'
                    ? 'border-emerald-300 dark:border-emerald-800'
                    : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                  {t.tone === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                  <span>{t.title}</span>
                </div>
                {t.detail && (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{t.detail}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismissToast(t.id)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
