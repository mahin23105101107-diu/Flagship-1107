/**
 * Flag Hygiene Engine (FR9).
 * Identifies stale feature flags meeting either condition:
 *   1. Not evaluated for >= 30 days
 *   2. Fully rolled out (100% enabled) for >= 14 days
 */

import type {
  Environment,
  FeatureFlag,
  FlagEnvironmentConfig,
  Project,
  PublicUser,
  StaleFlagReport,
} from '../types/flagship';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function detectStaleFlags(
  flags: FeatureFlag[],
  configs: FlagEnvironmentConfig[],
  projects: Project[],
  environments: Environment[],
  users: PublicUser[],
  now: Date = new Date(),
): StaleFlagReport[] {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const envMap = new Map(environments.map((e) => [e.id, e]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  const reports: StaleFlagReport[] = [];

  for (const config of configs) {
    const flag = flags.find((f) => f.id === config.flagId);
    if (!flag || flag.archived) continue;

    const project = projectMap.get(flag.projectId);
    const env = envMap.get(config.environmentId);
    if (!project || !env) continue;

    const owner = userMap.get(flag.ownerId);

    const daysSinceEvaluation = config.lastEvaluatedAt
      ? Math.floor((now.getTime() - Date.parse(config.lastEvaluatedAt)) / MS_PER_DAY)
      : Math.floor((now.getTime() - Date.parse(flag.createdAt)) / MS_PER_DAY);

    const notEvaluated30d = daysSinceEvaluation >= 30;

    let daysAtFullRollout: number | null = null;
    if (config.enabled && !config.killSwitchActive && config.rolloutPercentage >= 100 && config.fullRolloutSince) {
      daysAtFullRollout = Math.floor((now.getTime() - Date.parse(config.fullRolloutSince)) / MS_PER_DAY);
    }
    const fullRollout14d = daysAtFullRollout !== null && daysAtFullRollout >= 14;

    if (!notEvaluated30d && !fullRollout14d) continue;

    const staleReason: StaleFlagReport['staleReason'] =
      notEvaluated30d && fullRollout14d
        ? 'BOTH'
        : notEvaluated30d
          ? 'NOT_EVALUATED_30D'
          : 'FULL_ROLLOUT_14D';

    const recommendation =
      staleReason === 'FULL_ROLLOUT_14D'
        ? 'Remove flag conditional from code, keep winning path, and archive flag.'
        : staleReason === 'NOT_EVALUATED_30D'
          ? 'Verify no active SDK instances reference this key, then archive flag.'
          : 'Flag is permanently at 100% and unused for 30+ days — safe to remove and archive immediately.';

    reports.push({
      flagId: flag.id,
      flagKey: flag.key,
      flagName: flag.name,
      projectId: project.id,
      projectName: project.name,
      environmentId: env.id,
      environmentName: env.name,
      ownerName: owner?.name ?? 'Unassigned',
      lastEvaluatedAt: config.lastEvaluatedAt,
      daysSinceEvaluation,
      rolloutPercentage: config.rolloutPercentage,
      daysAtFullRollout,
      staleReason,
      recommendation,
    });
  }

  return reports.sort((a, b) => (b.daysSinceEvaluation ?? 0) - (a.daysSinceEvaluation ?? 0));
}
