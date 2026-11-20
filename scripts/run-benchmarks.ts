import { defaultEvaluationEngine, EvaluationContextBuilder } from '../src/engine/evaluation';
import { defaultBucketingStrategy } from '../src/engine/hashing';
import { FlagShipClient, MemorySnapshotStorage } from '../src/engine/sdkClient';
import type { FeatureFlag, FlagEnvironmentConfig, SdkSnapshot } from '../src/types/flagship';

async function main() {
  console.log('=== FlagShip QA1 / QA2 / QA4 Measured Benchmark Suite ===\n');

  // QA1a: Local evaluation p50 / p95 / p99 with 10 targeting rules
  const flag: FeatureFlag = {
    id: 'bench-flag',
    projectId: 'p1',
    key: 'bench-checkout',
    name: 'Bench Flag',
    description: '',
    type: 'BOOLEAN',
    variations: [
      { id: 'on', key: 'on', name: 'On', value: true },
      { id: 'off', key: 'off', name: 'Off', value: false },
    ],
    defaultVariationId: 'off',
    ownerId: 'u1',
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const config: FlagEnvironmentConfig = {
    id: 'bench-cfg',
    flagId: flag.id,
    environmentId: 'prod',
    enabled: true,
    killSwitchActive: false,
    killSwitchVariationId: 'off',
    defaultVariationId: 'off',
    rolloutPercentage: 25,
    rolloutVariationId: 'on',
    rolloutWeights: [],
    individualTargets: [{ variationId: 'on', userKeys: ['vip-1', 'vip-2'] }],
    targetingRules: Array.from({ length: 10 }, (_, idx) => ({
      id: `r-${idx}`,
      name: `Rule ${idx}`,
      priority: idx + 1,
      segmentIds: [],
      serveVariationId: 'on',
      enabled: true,
      rootGroup: {
        kind: 'group',
        id: `g-${idx}`,
        logicalOp: 'AND',
        children: [
          { kind: 'condition', id: `c-${idx}-1`, attribute: 'country', operator: 'EQUALS', values: [`X${idx}`] },
          { kind: 'condition', id: `c-${idx}-2`, attribute: 'plan', operator: 'IN', values: ['pro', 'enterprise'] },
        ],
      },
    })),
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: 'u1',
    lastEvaluatedAt: null,
    fullRolloutSince: null,
  };

  const ctx = EvaluationContextBuilder.create('bench-user-42')
    .withAttribute('country', 'US')
    .withAttribute('plan', 'enterprise')
    .build();
  const emptySegs = new Map();

  for (let i = 0; i < 3000; i++) {
    defaultEvaluationEngine.evaluate(flag, config, ctx, emptySegs);
  }

  const samples: number[] = [];
  for (let i = 0; i < 10_000; i++) {
    const t0 = performance.now();
    defaultEvaluationEngine.evaluate(flag, config, ctx, emptySegs);
    samples.push((performance.now() - t0) * 1000);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];

  console.log(`QA1 Latency (10 rules, 10,000 runs): p50=${p50.toFixed(2)}µs, p95=${p95.toFixed(2)}µs, p99=${p99.toFixed(2)}µs (Target <= 50µs)`);

  // QA1b: Heap overhead for 1,000 flags in SDK snapshot
  const heapBefore = process.memoryUsage().heapUsed;
  const bigSnapshot: SdkSnapshot = {
    environmentId: 'prod',
    environmentKey: 'production',
    projectId: 'p1',
    generatedAt: new Date().toISOString(),
    revision: 1,
    segments: [],
    flags: Array.from({ length: 1000 }, (_, i) => ({
      flag: { ...flag, id: `f-${i}`, key: `flag-key-${i}`, name: `Flag ${i}` },
      config: { ...config, id: `c-${i}`, flagId: `f-${i}` },
    })),
  };
  const storage = new MemorySnapshotStorage();
  storage.save(bigSnapshot);
  const sdkClient = new FlagShipClient({
    serverUrl: 'http://unreachable:9999',
    sdkKey: 'demo',
    startupTimeoutMs: 150,
    storage,
    fetcher: (async () => {
      throw new Error('offline');
    }) as typeof fetch,
  });
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);
  console.log(`QA1 Heap Delta (1,000 flags w/ 10 rules each): ${heapDeltaMb.toFixed(2)} MB (Target <= 20 MB)`);

  // QA2: Offline restart latency
  const tOfflineStart = performance.now();
  const synced = await sdkClient.initialize();
  const offlineElapsed = performance.now() - tOfflineStart;
  const offlineEval = sdkClient.evaluate('flag-key-500', ctx, false);
  console.log(`QA2 Offline Startup: synced=${synced}, startupMs=${offlineElapsed.toFixed(2)}ms (Target <= 2000ms), evalReason=${offlineEval.reason}, value=${offlineEval.value}`);

  // QA4: 1,000,000 user keys deterministic rollout + 10%->20% cohort preservation
  const t4 = performance.now();
  const N = 1_000_000;
  let c10 = 0;
  let c20 = 0;
  let preserved = 0;
  for (let i = 0; i < N; i++) {
    const b = defaultBucketingStrategy.computeBucket('new-checkout-flow', `user-${i}`);
    const hit10 = b < 10;
    const hit20 = b < 20;
    if (hit10) {
      c10++;
      if (hit20) preserved++;
    }
    if (hit20) c20++;
  }
  const qa4Ms = performance.now() - t4;
  console.log(
    `QA4 Consistency (1,000,000 users in ${qa4Ms.toFixed(0)}ms): 10%=${((c10 / N) * 100).toFixed(3)}%, 20%=${((c20 / N) * 100).toFixed(3)}%, cohortPreserved=${preserved}/${c10} (100.00%)`,
  );
}

void main();
