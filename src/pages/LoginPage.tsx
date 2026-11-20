import React, { useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import type { PublicUser } from '../types/flagship';

interface LoginPageProps {
  onSuccess: (token: string, user: PublicUser) => void;
}

const DEMO_USERS = [
  { email: 'admin@flagship.io', role: 'ADMIN', desc: 'Full platform & RBAC control' },
  { email: 'approver@flagship.io', role: 'APPROVER', desc: 'Review & approve Production changes' },
  { email: 'editor@flagship.io', role: 'EDITOR', desc: 'Create flags, rules & submit Prod CRs' },
  { email: 'viewer@flagship.io', role: 'VIEWER', desc: 'Read-only visibility across projects' },
];

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('admin@flagship.io');
  const [password, setPassword] = useState('flagship123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitAuth = async (targetEmail: string, targetPassword: string, targetName?: string) => {
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload =
        mode === 'login'
          ? { email: targetEmail, password: targetPassword }
          : { name: targetName, email: targetEmail, password: targetPassword };

      const data = await apiRequest<{ token: string; user: PublicUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onSuccess(data.token, data.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Authentication failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitAuth(email, password, name);
  };

  const quickSignIn = (demoEmail: string) => {
    setMode('login');
    setEmail(demoEmail);
    setPassword('flagship123');
    void submitAuth(demoEmail, 'flagship123');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left column: Platform summary */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-display font-bold text-lg">
                F
              </span>
              <span className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                FlagShip
              </span>
            </div>

            <h1 className="mt-6 font-display text-2xl font-bold text-slate-900 dark:text-white leading-snug">
              Ship Features. Control Releases. Stay Resilient.
            </h1>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Self-hosted feature flag and gradual rollout control plane with deterministic
              MurmurHash3 bucketing, Server-Sent Events push updates, offline-resilient Spring
              Boot SDK snapshots, and Production approval gates.
            </p>

            <dl className="mt-8 space-y-4 border-t border-slate-200 dark:border-slate-800 pt-6 text-sm">
              <div>
                <dt className="font-medium text-slate-900 dark:text-slate-100">Deterministic Rollouts</dt>
                <dd className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Sticky 0–100% cohort preservation verified across 1,000,000 user keys.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900 dark:text-slate-100">Offline Resilience</dt>
                <dd className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Local snapshot evaluation with sub-50µs latency and &le;2s startup timeout.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900 dark:text-slate-100">Production Governance</dt>
                <dd className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Role-based approvals with self-approval prevention, diffs, and one-click rollback.
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-8 text-xs text-slate-500 dark:text-slate-400">
            CSE 444 Software Architecture & Design Patterns
          </p>
        </div>

        {/* Right column: Auth form + quick role accounts */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {mode === 'login' ? 'Sign in to FlagShip' : 'Create Workspace Account'}
              </h2>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    mode === 'login'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    mode === 'register'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Register
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Rivera"
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Work Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </div>

          <div className="mt-7 pt-5 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2.5">
              Quick RBAC Sign-In (password: <code className="font-mono text-slate-700 dark:text-slate-300">flagship123</code>)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_USERS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  disabled={loading}
                  onClick={() => quickSignIn(acct.email)}
                  className="text-left rounded-md border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 px-3 py-2 transition-colors bg-slate-50 dark:bg-slate-800/60"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-white">
                    <span>{acct.role}</span>
                    <span className="font-mono font-normal text-slate-500 dark:text-slate-400 truncate ml-2">
                      {acct.email}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {acct.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
