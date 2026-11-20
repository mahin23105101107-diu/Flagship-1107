import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FlagShipClient, type SnapshotStorage } from './sdkClient';
import { EvaluationContextBuilder } from './evaluation';
import type { SdkSnapshot } from '../types/flagship';

class DiskSnapshotStorage implements SnapshotStorage {
  constructor(private readonly filePath: string) {}
  load(): SdkSnapshot | null {
    if (!fs.existsSync(this.filePath)) return null;
    return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as SdkSnapshot;
  }
  save(snapshot: SdkSnapshot): void {
    fs.writeFileSync(this.filePath, JSON.stringify(snapshot), 'utf-8');
  }
}

const sampleSnapshot: SdkSnapshot = {
  environmentId: 'env-prod',
  environmentKey: 'production',
  projectId: 'proj-1',
  generatedAt: '2026-11-20T10:00:00.000Z',
  revision: 4,
  flags: [
    {
      flag: {
        id: 'f-1',
        projectId: 'proj-1',
        key: 'new-dashboard',
        name: 'New Dashboard',
        description: '',
        type: 'BOOLEAN',
        variations: [
          { id: 'v-on', key: 'on', name: 'On', value: true },
          { id: 'v-off', key: 'off', name: 'Off', value: false },
        ],
        defaultVariationId: 'v-off',
        ownerId: 'u-1',
        tags: [],
        archived: false,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z',
      },
      config: {
        id: 'c-1',
        flagId: 'f-1',
        environmentId: 'env-prod',
        enabled: true,
        killSwitchActive: false,
        killSwitchVariationId: 'v-off',
        defaultVariationId: 'v-off',
        rolloutPercentage: 100,
        rolloutVariationId: 'v-on',
        rolloutWeights: [],
        individualTargets: [],
        targetingRules: [],
        version: 4,
        updatedAt: '2026-11-20T00:00:00Z',
        updatedBy: 'u-1',
        lastEvaluatedAt: null,
        fullRolloutSince: null,
      },
    },
  ],
  segments: [],
};

test('FR6 & QA2: SDK persists snapshot, restarts offline in <2s, evaluates without throwing, and uses safe defaults when empty', async () => {
  const tmpFile = path.join(os.tmpdir(), `flagship-snap-${Date.now()}.json`);
  const storage = new DiskSnapshotStorage(tmpFile);

  // 1. First client boots online and persists snapshot to disk
  const onlineFetcher = (async () =>
    new Response(JSON.stringify(sampleSnapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  const client1 = new FlagShipClient({
    serverUrl: 'http://localhost:3000',
    sdkKey: 'fs_prod_demo',
    storage,
    fetcher: onlineFetcher,
  });

  const synced = await client1.initialize();
  assert.equal(synced, true);
  assert.equal(fs.existsSync(tmpFile), true);
  assert.equal(client1.isEnabled('new-dashboard', EvaluationContextBuilder.create('user-1').build(), false), true);

  // 2. Server goes offline (hanging connection simulated). Restarted client must respect <= 2s timeout & serve disk snapshot!
  const offlineHangingFetcher = ((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted due to timeout')));
    })) as typeof fetch;

  const t0 = performance.now();
  const client2 = new FlagShipClient({
    serverUrl: 'http://offline-server:9999',
    sdkKey: 'fs_prod_demo',
    startupTimeoutMs: 250,
    storage: new DiskSnapshotStorage(tmpFile),
    fetcher: offlineHangingFetcher,
  });

  const syncedOffline = await client2.initialize();
  const elapsedMs = performance.now() - t0;

  assert.equal(syncedOffline, false);
  assert.ok(elapsedMs < 2000, `Startup wait exceeded 2000ms: ${elapsedMs}ms`);
  assert.equal(client2.getMetrics().offlineMode, true);
  // Still evaluates cleanly from persisted snapshot!
  assert.equal(client2.isEnabled('new-dashboard', EvaluationContextBuilder.create('user-1').build(), false), true);

  // 3. Brand new client with NO snapshot and offline server returns safe default with zero exceptions
  const emptyClient = new FlagShipClient({
    serverUrl: 'http://offline-server:9999',
    sdkKey: 'fs_prod_demo',
    startupTimeoutMs: 100,
    fetcher: (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch,
  });

  await emptyClient.initialize();
  assert.equal(emptyClient.isEnabled('unknown-flag', EvaluationContextBuilder.create('user-1').build(), false), false);
  assert.equal(emptyClient.getString('homepage-layout', EvaluationContextBuilder.create('user-1').build(), 'classic'), 'classic');

  fs.rmSync(tmpFile, { force: true });
});
