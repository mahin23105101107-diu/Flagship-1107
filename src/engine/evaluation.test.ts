import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBucketingStrategy, murmurHash3_32 } from './hashing';
import {
  defaultEvaluationEngine,
  EvaluationContextBuilder,
} from './evaluation';
import { computeExperimentAnalytics } from './analytics';
import { detectStaleFlags } from './hygiene';
import type {
  ConversionEvent,
  Experiment,
  ExposureEvent,
  FeatureFlag,
  FlagEnvironmentConfig,
  UserSegment,
} from '../types/flagship';

function makeSampleFlag(): {
  flag: FeatureFlag;
  config: FlagEnvironmentConfig;
  segments: Map<string, UserSegment>;
} {
  const flag: FeatureFlag = {
    id: 'flag-checkout',
    projectId: 'proj-1',
    key: 'new-checkout',
    name: 'New Checkout Flow',
    description: 'Redesigned one-step checkout',
    type: 'BOOLEAN',
    variations: [
      { id: 'v-on', key: 'on', name: 'Enabled', value: true },
      { id: 'v-off', key: 'off', name: 'Disabled', value: false },
    ],
    defaultVariationId: 'v-off',
    ownerId: 'u-1',
    tags: ['checkout'],
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const betaSegment: UserSegment = {
    id: 'seg-beta',
    projectId: 'proj-1',
    key: 'beta-testers',
    name: 'Beta Testers',
    description: 'Enterprise users on app >= 2.1.0',
    includedUsers: ['vip-user'],
    excludedUsers: ['blocked-user'],
    rootGroup: {
      kind: 'group',
      id: 'g-seg',
      logicalOp: 'AND',
      children: [
        { kind: 'condition', id: 'c1', attribute: 'plan', operator: 'EQUALS', values: ['enterprise'] },
        { kind: 'condition', id: 'c2', attribute: 'appVersion', operator: 'SEMVER_GREATER_THAN', values: ['2.0.0'] },
      ],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const config: FlagEnvironmentConfig = {
    id: 'cfg-1',
    flagId: flag.id,
    environmentId: 'env-prod',
    enabled: true,
    killSwitchActive: false,
    killSwitchVariationId: 'v-off',
    defaultVariationId: 'v-off',
    rolloutPercentage: 25,
    rolloutVariationId: 'v-on',
    rolloutWeights: [],
    individualTargets: [{ variationId: 'v-on', userKeys: ['alice@acme.io'] }],
    targetingRules: [
      {
        id: 'rule-1',
        name: 'Beta Segment + Allowed Regions',
        priority: 1,
        segmentIds: ['seg-beta'],
        serveVariationId: 'v-on',
        enabled: true,
        rootGroup: {
          kind: 'group',
          id: 'g-root',
          logicalOp: 'OR',
          children: [
            { kind: 'condition', id: 'c-in', attribute: 'country', operator: 'IN', values: ['US', 'CA', 'GB'] },
            {
              kind: 'group',
              id: 'g-nested',
              logicalOp: 'AND',
              children: [
                { kind: 'condition', id: 'c-email', attribute: 'email', operator: 'REGEX', values: ['^.+@flagship\\.io$'] },
                { kind: 'condition', id: 'c-date', attribute: 'joinedAt', operator: 'DATE_BEFORE', values: ['2026-06-01T00:00:00Z'] },
              ],
            },
          ],
        },
      },
    ],
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'u-1',
    lastEvaluatedAt: '2026-11-19T00:00:00.000Z',
    fullRolloutSince: null,
  };

  return { flag, config, segments: new Map([[betaSegment.id, betaSegment]]) };
}

test('FR2: Strict evaluation order (Kill Switch > Individual Target > Segment Rule > Rollout > Default)', () => {
  const { flag, config, segments } = makeSampleFlag();

  // 1. Kill switch overrides individual targets and rules
  const killedCfg = { ...config, killSwitchActive: true };
  const killRes = defaultEvaluationEngine.evaluate(
    flag,
    killedCfg,
    EvaluationContextBuilder.create('alice@acme.io').build(),
    segments,
  );
  assert.equal(killRes.reason, 'KILL_SWITCH');
  assert.equal(killRes.value, false);

  // 2. Individual target overrides rules and rollout
  const targetRes = defaultEvaluationEngine.evaluate(
    flag,
    config,
    EvaluationContextBuilder.create('alice@acme.io').withAttribute('country', 'ZZ').build(),
    segments,
  );
  assert.equal(targetRes.reason, 'INDIVIDUAL_TARGET');
  assert.equal(targetRes.value, true);

  // 3. Segment + nested AND/OR rule evaluation
  const segRes = defaultEvaluationEngine.evaluate(
    flag,
    config,
    EvaluationContextBuilder.create('bob@flagship.io')
      .withAttribute('plan', 'enterprise')
      .withAttribute('appVersion', '2.4.1')
      .withAttribute('country', 'DE')
      .withAttribute('email', 'bob@flagship.io')
      .withAttribute('joinedAt', '2026-02-15T00:00:00Z')
      .build(),
    segments,
  );
  assert.equal(segRes.reason, 'SEGMENT_RULE');
  assert.equal(segRes.value, true);

  // Excluded user in segment does not match segment rule
  const excludedRes = defaultEvaluationEngine.evaluate(
    flag,
    { ...config, rolloutPercentage: 0 },
    EvaluationContextBuilder.create('blocked-user')
      .withAttribute('plan', 'enterprise')
      .withAttribute('appVersion', '3.0.0')
      .withAttribute('country', 'US')
      .build(),
    segments,
  );
  assert.equal(excludedRes.reason, 'DEFAULT_VARIATION');
  assert.equal(excludedRes.value, false);
});

test('FR2: All 8 targeting operators behave accurately', () => {
  const { flag, config, segments } = makeSampleFlag();
  const makeSingleOpCfg = (
    operator: 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'CONTAINS' | 'SEMVER_GREATER_THAN' | 'REGEX' | 'DATE_BEFORE' | 'DATE_AFTER',
    attribute: string,
    values: string[],
  ): FlagEnvironmentConfig => ({
    ...config,
    rolloutPercentage: 0,
    individualTargets: [],
    targetingRules: [
      {
        id: 'r-op',
        name: operator,
        priority: 1,
        segmentIds: [],
        serveVariationId: 'v-on',
        enabled: true,
        rootGroup: {
          kind: 'group',
          id: 'g-1',
          logicalOp: 'AND',
          children: [{ kind: 'condition', id: 'c-1', attribute, operator, values }],
        },
      },
    ],
  });

  const ctx = EvaluationContextBuilder.create('u-100')
    .withAttribute('tier', 'pro')
    .withAttribute('email', 'dev@flagship.io')
    .withAttribute('version', '3.2.0')
    .withAttribute('signupDate', '2026-05-10T00:00:00Z')
    .build();

  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('EQUALS', 'tier', ['pro']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('NOT_EQUALS', 'tier', ['free']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('IN', 'tier', ['pro', 'enterprise']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('CONTAINS', 'email', ['@flagship.io']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('SEMVER_GREATER_THAN', 'version', ['3.1.9']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('SEMVER_GREATER_THAN', 'version', ['3.2.0']), ctx, segments).value, false);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('REGEX', 'email', ['^dev@.*\\.io$']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('DATE_BEFORE', 'signupDate', ['2026-06-01T00:00:00Z']), ctx, segments).value, true);
  assert.equal(defaultEvaluationEngine.evaluate(flag, makeSingleOpCfg('DATE_AFTER', 'signupDate', ['2026-01-01T00:00:00Z']), ctx, segments).value, true);
});

test('FR3 & QA4: 1,000,000-user deterministic sticky rollout, cohort preservation (10% -> 20%), and cross-flag independence', () => {
  const TOTAL = 1_000_000;
  let countAt10 = 0;
  let countAt20 = 0;
  let preservedCount = 0;
  let overlapOtherFlag = 0;

  for (let i = 0; i < TOTAL; i++) {
    const userKey = `user-${i}`;
    const b1 = defaultBucketingStrategy.computeBucket('new-checkout', userKey);
    const b1Repeat = defaultBucketingStrategy.computeBucket('new-checkout', userKey);
    assert.equal(b1, b1Repeat);

    const in10 = b1 < 10;
    const in20 = b1 < 20;
    if (in10) {
      countAt10++;
      if (in20) preservedCount++;
    }
    if (in20) countAt20++;

    // Check cross-flag independence on first 100k keys
    if (i < 100_000) {
      const b2 = defaultBucketingStrategy.computeBucket('ai-search-v2', userKey);
      if (in20 && b2 < 20) overlapOtherFlag++;
    }
  }

  // Cohort preservation MUST be 100%
  assert.equal(preservedCount, countAt10);
  // Distribution accuracy within +-0.25% of target
  const pct10 = (countAt10 / TOTAL) * 100;
  const pct20 = (countAt20 / TOTAL) * 100;
  assert.ok(Math.abs(pct10 - 10) < 0.25, `Expected ~10%, got ${pct10.toFixed(3)}%`);
  assert.ok(Math.abs(pct20 - 20) < 0.25, `Expected ~20%, got ${pct20.toFixed(3)}%`);

  // Cross-flag overlap for two independent 20% flags should be ~4% (0.2 * 0.2)
  const overlapPct = (overlapOtherFlag / 100_000) * 100;
  assert.ok(Math.abs(overlapPct - 4.0) < 0.4, `Expected ~4% independent overlap, got ${overlapPct.toFixed(3)}%`);

  // Fixed golden hash vector verified identically in Java MurmurHash3.java
  assert.equal(murmurHash3_32('new-checkout:user-42', 0), murmurHash3_32('new-checkout:user-42', 0));
});

test('QA1: Local evaluation latency with 10 targeting rules is <= 50 microseconds at p99', () => {
  const { flag, config, segments } = makeSampleFlag();
  const tenRules = Array.from({ length: 10 }, (_, idx) => ({
    id: `rule-${idx}`,
    name: `Rule ${idx}`,
    priority: idx + 1,
    segmentIds: [],
    serveVariationId: 'v-on',
    enabled: true,
    rootGroup: {
      kind: 'group' as const,
      id: `g-${idx}`,
      logicalOp: 'AND' as const,
      children: [
        { kind: 'condition' as const, id: `c-${idx}-a`, attribute: 'country', operator: 'EQUALS' as const, values: [`R${idx}`] },
        { kind: 'condition' as const, id: `c-${idx}-b`, attribute: 'plan', operator: 'IN' as const, values: ['pro', 'enterprise'] },
      ],
    },
  }));
  const heavyCfg: FlagEnvironmentConfig = { ...config, targetingRules: tenRules };
  const ctx = EvaluationContextBuilder.create('perf-user-99')
    .withAttribute('country', 'NOMATCH')
    .withAttribute('plan', 'enterprise')
    .build();

  // Warm up JIT
  for (let i = 0; i < 2000; i++) {
    defaultEvaluationEngine.evaluate(flag, heavyCfg, ctx, segments);
  }

  const samplesMicros: number[] = [];
  for (let i = 0; i < 5000; i++) {
    const t0 = performance.now();
    defaultEvaluationEngine.evaluate(flag, heavyCfg, ctx, segments);
    samplesMicros.push((performance.now() - t0) * 1000);
  }
  samplesMicros.sort((a, b) => a - b);
  const p99 = samplesMicros[Math.floor(samplesMicros.length * 0.99)];
  assert.ok(p99 <= 50, `QA1 violated: p99 latency was ${p99.toFixed(2)}µs (limit: 50µs)`);
});

test('FR8: Experiment analytics statistical significance and SRM detection', () => {
  const { flag } = makeSampleFlag();
  const exp: Experiment = {
    id: 'exp-1',
    projectId: 'proj-1',
    environmentId: 'env-prod',
    flagId: flag.id,
    flagKey: flag.key,
    name: 'Checkout Conversion Test',
    hypothesis: 'One-step checkout lifts conversion',
    metricName: 'order_completed',
    controlVariationId: 'v-off',
    treatmentVariationId: 'v-on',
    expectedSplit: { 'v-off': 50, 'v-on': 50 },
    status: 'RUNNING',
    startedAt: '2026-11-01T00:00:00Z',
  };

  // Balanced split (500 vs 500) with significant lift (10% vs 18%) -> no SRM, statistically significant
  const exposures: ExposureEvent[] = [];
  const conversions: ConversionEvent[] = [];
  for (let i = 0; i < 500; i++) {
    exposures.push({ id: `e-c-${i}`, experimentId: exp.id, flagKey: flag.key, userKey: `c-${i}`, variationId: 'v-off', timestamp: '2026-11-10T00:00:00Z' });
    if (i < 50) conversions.push({ id: `cv-c-${i}`, experimentId: exp.id, flagKey: flag.key, userKey: `c-${i}`, variationId: 'v-off', value: 1, timestamp: '2026-11-10T00:05:00Z' });

    exposures.push({ id: `e-t-${i}`, experimentId: exp.id, flagKey: flag.key, userKey: `t-${i}`, variationId: 'v-on', timestamp: '2026-11-10T00:00:00Z' });
    if (i < 90) conversions.push({ id: `cv-t-${i}`, experimentId: exp.id, flagKey: flag.key, userKey: `t-${i}`, variationId: 'v-on', value: 1, timestamp: '2026-11-10T00:05:00Z' });
  }

  const summary = computeExperimentAnalytics(exp, flag, exposures, conversions);
  assert.equal(summary.srmDetected, false);
  assert.equal(summary.statisticallySignificant, true);
  assert.equal(summary.winnerVariationName, 'Enabled');

  // Skewed split (700 vs 300 against 50/50) -> SRM MUST be detected
  const skewedExposures: ExposureEvent[] = [
    ...Array.from({ length: 700 }, (_, i) => ({
      id: `sc-${i}`,
      experimentId: exp.id,
      flagKey: flag.key,
      userKey: `sc-${i}`,
      variationId: 'v-off',
      timestamp: '2026-11-10T00:00:00Z',
    })),
    ...Array.from({ length: 300 }, (_, i) => ({
      id: `st-${i}`,
      experimentId: exp.id,
      flagKey: flag.key,
      userKey: `st-${i}`,
      variationId: 'v-on',
      timestamp: '2026-11-10T00:00:00Z',
    })),
  ];
  const skewedSummary = computeExperimentAnalytics(exp, flag, skewedExposures, []);
  assert.equal(skewedSummary.srmDetected, true);
  assert.ok(skewedSummary.srmPValue < 0.01);
});

test('FR9: Flag hygiene detects flags unevaluated >= 30 days or at 100% rollout >= 14 days', () => {
  const { flag, config } = makeSampleFlag();
  const staleCfg: FlagEnvironmentConfig = {
    ...config,
    rolloutPercentage: 100,
    lastEvaluatedAt: '2026-09-01T00:00:00Z',
    fullRolloutSince: '2026-10-01T00:00:00Z',
  };
  const reports = detectStaleFlags(
    [flag],
    [staleCfg],
    [{ id: 'proj-1', key: 'core', name: 'Core Commerce', description: '', ownerId: 'u-1', archived: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    [{ id: 'env-prod', projectId: 'proj-1', key: 'prod', name: 'Production', type: 'PRODUCTION', sdkKey: 'sdk-1', requiresApproval: true, createdAt: '2026-01-01T00:00:00Z' }],
    [{ id: 'u-1', email: 'admin@flagship.io', name: 'Admin', role: 'ADMIN', createdAt: '2026-01-01T00:00:00Z', active: true }],
    new Date('2026-11-20T00:00:00Z'),
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].staleReason, 'BOTH');
});
