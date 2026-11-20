import { useCallback, useEffect, useState } from 'react';
import {
  apiRequest,
  clearAuthSession,
  getStoredToken,
  getStoredUser,
  saveAuthSession,
} from './api/client';
import { Layout, type NavPage, type ToastMessage } from './components/Layout';
import { ExperimentAnalyticsPage, FlagHygienePage } from './pages/AnalyticsHygienePages';
import { DashboardOverview } from './pages/DashboardOverview';
import { CreateFlagPage, FlagDetailsPage, FlagsListPage } from './pages/FlagsPages';
import { ApprovalCenterPage, ChangeHistoryPage } from './pages/GovernancePages';
import { LoginPage } from './pages/LoginPage';
import {
  SdkSetupPage,
  SettingsPage,
  SystemHealthPage,
  TeamMembersPage,
} from './pages/PlatformPages';
import { EnvironmentsPage, ProjectsPage } from './pages/ProjectsEnvironmentsPages';
import {
  RolloutManagementPage,
  TargetingRulesPage,
  UserSegmentsPage,
} from './pages/TargetingSegmentsRolloutPages';
import type { Environment, Project, PublicUser } from './types/flagship';

export default function App() {
  const [user, setUser] = useState<PublicUser | null>(() =>
    getStoredToken() ? getStoredUser() : null,
  );
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('flagship_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [projects, setProjects] = useState<Array<Project & { environmentCount?: number; flagCount?: number; memberCount?: number }>>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [selectedFlagId, setSelectedFlagId] = useState<string>('flg-checkout');

  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [staleFlagCount, setStaleFlagCount] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback(
    (tone: ToastMessage['tone'], title: string, detail?: string) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, tone, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    [],
  );

  // Sync Tailwind v4 .dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('flagship_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore
    }
  }, [darkMode]);

  // Support ?autostart=1 for automated testing / quick demo entry
  useEffect(() => {
    if (user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      void apiRequest<{ token: string; user: PublicUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@flagship.io', password: 'flagship123' }),
      })
        .then((res) => {
          saveAuthSession(res.token, res.user);
          setUser(res.user);
        })
        .catch(() => {
          // Stay on login page on failure
        });
    }
  }, [user]);

  const loadWorkspaceMeta = useCallback(async () => {
    if (!user) return;
    try {
      const [pRes, eRes, ovRes] = await Promise.all([
        apiRequest<{ items: Array<Project & { environmentCount?: number; flagCount?: number; memberCount?: number }> }>('/projects'),
        apiRequest<{ items: Environment[] }>('/environments'),
        apiRequest<{ kpis: { pendingApprovals: number; staleFlagCount: number } }>('/dashboard/overview'),
      ]);
      setProjects(pRes.items);
      setEnvironments(eRes.items);
      setPendingApprovalCount(ovRes.kpis.pendingApprovals);
      setStaleFlagCount(ovRes.kpis.staleFlagCount);

      setSelectedProjectId((prevProj) => {
        const valid = pRes.items.find((p) => p.id === prevProj && !p.archived);
        const nextProjId = valid ? valid.id : (pRes.items.find((p) => !p.archived)?.id ?? '');
        setSelectedEnvId((prevEnv) => {
          const validEnv = eRes.items.find((e) => e.id === prevEnv && e.projectId === nextProjId);
          if (validEnv) return validEnv.id;
          const prod = eRes.items.find((e) => e.projectId === nextProjId && e.type === 'PRODUCTION');
          return prod?.id ?? eRes.items.find((e) => e.projectId === nextProjId)?.id ?? '';
        });
        return nextProjId;
      });
    } catch {
      // Token may have expired
      clearAuthSession();
      setUser(null);
    }
  }, [user]);

  useEffect(() => {
    void loadWorkspaceMeta();
  }, [loadWorkspaceMeta, refreshSignal]);

  // Live SSE EventSource connection for real-time updates (FR5)
  useEffect(() => {
    if (!user) return;
    const es = new EventSource('/api/v1/sdk/stream?scope=dashboard');
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    const onUpdate = () => {
      setRefreshSignal((n) => n + 1);
    };
    es.addEventListener('FLAG_CONFIG_UPDATED', onUpdate);
    es.addEventListener('KILL_SWITCH_TOGGLED', onUpdate);
    es.addEventListener('APPROVAL_RESOLVED', onUpdate);
    es.addEventListener('FLAG_ROLLED_BACK', onUpdate);
    es.addEventListener('SCHEDULE_EXECUTED', onUpdate);

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [user]);

  const triggerRefresh = useCallback(() => {
    setRefreshSignal((n) => n + 1);
  }, []);

  const handleProjectChange = (projId: string) => {
    setSelectedProjectId(projId);
    const firstEnv =
      environments.find((e) => e.projectId === projId && e.type === 'PRODUCTION') ??
      environments.find((e) => e.projectId === projId);
    if (firstEnv) setSelectedEnvId(firstEnv.id);
  };

  if (!user) {
    return (
      <LoginPage
        onSuccess={(token, loggedInUser) => {
          saveAuthSession(token, loggedInUser);
          setUser(loggedInUser);
          setActivePage('dashboard');
          notify('success', `Signed in as ${loggedInUser.name}`, `Role: ${loggedInUser.role}`);
        }}
      />
    );
  }

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
      user={user}
      onLogout={() => {
        clearAuthSession();
        setUser(null);
      }}
      darkMode={darkMode}
      onToggleDarkMode={() => setDarkMode((d) => !d)}
      projects={projects}
      selectedProjectId={selectedProjectId}
      onSelectProject={handleProjectChange}
      environments={environments}
      selectedEnvId={selectedEnvId}
      onSelectEnv={setSelectedEnvId}
      pendingApprovalCount={pendingApprovalCount}
      staleFlagCount={staleFlagCount}
      sseConnected={sseConnected}
      toasts={toasts}
      onDismissToast={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
    >
      {activePage === 'dashboard' && (
        <DashboardOverview
          onNavigate={setActivePage}
          onOpenFlag={(id) => {
            setSelectedFlagId(id);
            setActivePage('flag-details');
          }}
          refreshSignal={refreshSignal}
        />
      )}

      {activePage === 'projects' && (
        <ProjectsPage
          projects={projects}
          user={user}
          onRefresh={triggerRefresh}
          onNotify={notify}
          onSelectProject={(id) => {
            handleProjectChange(id);
            setActivePage('flags');
          }}
        />
      )}

      {activePage === 'environments' && (
        <EnvironmentsPage
          environments={environments}
          selectedProjectId={selectedProjectId}
          user={user}
          onRefresh={triggerRefresh}
          onNotify={notify}
        />
      )}

      {activePage === 'flags' && (
        <FlagsListPage
          projectId={selectedProjectId}
          environmentId={selectedEnvId}
          environments={environments}
          user={user}
          refreshSignal={refreshSignal}
          onOpenFlag={(id) => {
            setSelectedFlagId(id);
            setActivePage('flag-details');
          }}
          onNavigate={setActivePage}
          onNotify={notify}
          onRefresh={triggerRefresh}
        />
      )}

      {activePage === 'create-flag' && (
        <CreateFlagPage
          projectId={selectedProjectId}
          onCreated={(flagId) => {
            setSelectedFlagId(flagId);
            triggerRefresh();
            setActivePage('flag-details');
          }}
          onCancel={() => setActivePage('flags')}
          onNotify={notify}
        />
      )}

      {activePage === 'flag-details' && (
        <FlagDetailsPage
          flagId={selectedFlagId}
          environmentId={selectedEnvId}
          onSelectEnv={setSelectedEnvId}
          onNavigate={setActivePage}
          onNotify={notify}
          onRefresh={triggerRefresh}
          user={user}
        />
      )}

      {activePage === 'targeting' && (
        <TargetingRulesPage
          projectId={selectedProjectId}
          environmentId={selectedEnvId}
          environments={environments}
          selectedFlagId={selectedFlagId}
          onSelectFlagId={setSelectedFlagId}
          user={user}
          onNotify={notify}
          onRefresh={triggerRefresh}
          refreshSignal={refreshSignal}
        />
      )}

      {activePage === 'segments' && (
        <UserSegmentsPage
          projectId={selectedProjectId}
          user={user}
          onNotify={notify}
          refreshSignal={refreshSignal}
        />
      )}

      {activePage === 'rollouts' && (
        <RolloutManagementPage
          projectId={selectedProjectId}
          environmentId={selectedEnvId}
          environments={environments}
          selectedFlagId={selectedFlagId}
          onSelectFlagId={setSelectedFlagId}
          user={user}
          onNotify={notify}
          onRefresh={triggerRefresh}
          refreshSignal={refreshSignal}
        />
      )}

      {activePage === 'history' && (
        <ChangeHistoryPage
          projectId={selectedProjectId}
          environmentId={selectedEnvId}
          user={user}
          refreshSignal={refreshSignal}
          onRefresh={triggerRefresh}
          onNotify={notify}
        />
      )}

      {activePage === 'approvals' && (
        <ApprovalCenterPage
          user={user}
          refreshSignal={refreshSignal}
          onRefresh={triggerRefresh}
          onNotify={notify}
        />
      )}

      {activePage === 'analytics' && (
        <ExperimentAnalyticsPage
          projectId={selectedProjectId}
          environmentId={selectedEnvId}
          user={user}
          refreshSignal={refreshSignal}
          onNotify={notify}
        />
      )}

      {activePage === 'hygiene' && (
        <FlagHygienePage
          user={user}
          refreshSignal={refreshSignal}
          onRefresh={triggerRefresh}
          onNotify={notify}
        />
      )}

      {activePage === 'team' && <TeamMembersPage user={user} onNotify={notify} />}

      {activePage === 'sdk' && (
        <SdkSetupPage
          environments={environments}
          selectedEnvId={selectedEnvId}
          onNotify={notify}
        />
      )}

      {activePage === 'health' && <SystemHealthPage refreshSignal={refreshSignal} />}

      {activePage === 'settings' && (
        <SettingsPage
          user={user}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onRefresh={triggerRefresh}
          onNotify={notify}
        />
      )}
    </Layout>
  );
}
