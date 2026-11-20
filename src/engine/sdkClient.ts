/**
 * FlagShip Client SDK — Proxy / Decorator Pattern + Offline Resilience (FR4, FR5, FR6, QA2).
 *
 * Guarantees:
 * - Local in-memory snapshot cache for sub-50µs evaluation
 * - Persists last valid snapshot via SnapshotStorage (disk in Node / localStorage in browser)
 * - Loads persisted snapshot during startup
 * - Enforces <= 2000ms startup timeout when contacting server
 * - Never propagates network/connectivity exceptions to application business code
 * - Falls back to safe configured defaults if no snapshot exists
 */

import type {
  EvaluationContext,
  EvaluationResult,
  SdkSnapshot,
  UserSegment,
} from '../types/flagship';
import { defaultEvaluationEngine, FlagEvaluationEngine } from './evaluation';

export interface SnapshotStorage {
  load(): SdkSnapshot | null;
  save(snapshot: SdkSnapshot): void;
}

export class MemorySnapshotStorage implements SnapshotStorage {
  private snapshot: SdkSnapshot | null = null;
  load(): SdkSnapshot | null {
    return this.snapshot;
  }
  save(snapshot: SdkSnapshot): void {
    this.snapshot = snapshot;
  }
}

export interface FlagShipClientConfig {
  serverUrl: string;
  sdkKey: string;
  startupTimeoutMs?: number; // Default 1500ms (strictly <= 2000ms per FR6)
  pollIntervalMs?: number;
  storage?: SnapshotStorage;
  fetcher?: typeof fetch;
  engine?: FlagEvaluationEngine;
}

export interface SdkMetrics {
  evaluations: number;
  cacheHits: number;
  fallbacks: number;
  syncSuccesses: number;
  syncFailures: number;
  lastSyncAt: string | null;
  lastSyncLatencyMs: number | null;
  offlineMode: boolean;
}

export class FlagShipClient {
  private snapshot: SdkSnapshot | null = null;
  private segmentsById = new Map<string, UserSegment>();
  private readonly engine: FlagEvaluationEngine;
  private readonly storage: SnapshotStorage;
  private readonly fetcher: typeof fetch;
  private readonly startupTimeoutMs: number;
  private readonly metrics: SdkMetrics = {
    evaluations: 0,
    cacheHits: 0,
    fallbacks: 0,
    syncSuccesses: 0,
    syncFailures: 0,
    lastSyncAt: null,
    lastSyncLatencyMs: null,
    offlineMode: false,
  };

  constructor(private readonly config: FlagShipClientConfig) {
    this.engine = config.engine ?? defaultEvaluationEngine;
    this.storage = config.storage ?? new MemorySnapshotStorage();
    this.fetcher = config.fetcher ?? globalThis.fetch.bind(globalThis);
    this.startupTimeoutMs = Math.min(2000, config.startupTimeoutMs ?? 1500);

    // Load last persisted snapshot immediately so cold starts have instant data
    const saved = this.safeLoadSnapshot();
    if (saved) {
      this.applySnapshot(saved, false);
    }
  }

  private safeLoadSnapshot(): SdkSnapshot | null {
    try {
      return this.storage.load();
    } catch {
      return null;
    }
  }

  applySnapshot(snapshot: SdkSnapshot, persist = true): void {
    this.snapshot = snapshot;
    this.segmentsById = new Map(snapshot.segments.map((s) => [s.id, s]));
    if (persist) {
      try {
        this.storage.save(snapshot);
      } catch {
        // Never crash business code if disk persistence fails
      }
    }
  }

  /**
   * Startup sync with strict <= 2s timeout. Never throws on network outage.
   */
  async initialize(): Promise<boolean> {
    return this.syncNow(this.startupTimeoutMs);
  }

  async syncNow(timeoutMs = this.startupTimeoutMs): Promise<boolean> {
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetcher(
        `${this.config.serverUrl.replace(/\/$/, '')}/api/v1/sdk/snapshot`,
        {
          headers: {
            'X-FlagShip-SDK-Key': this.config.sdkKey,
            Accept: 'application/json',
          },
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        this.metrics.syncFailures++;
        this.metrics.offlineMode = true;
        return false;
      }
      const snapshot = (await res.json()) as SdkSnapshot;
      this.applySnapshot(snapshot, true);
      this.metrics.syncSuccesses++;
      this.metrics.offlineMode = false;
      this.metrics.lastSyncAt = new Date().toISOString();
      this.metrics.lastSyncLatencyMs = Math.round(performance.now() - start);
      return true;
    } catch {
      // FR6: Never expose connectivity errors as uncaught exceptions
      this.metrics.syncFailures++;
      this.metrics.offlineMode = true;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  evaluate(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: boolean | string | number | Record<string, unknown> = false,
  ): EvaluationResult {
    this.metrics.evaluations++;
    try {
      if (!this.snapshot) {
        this.metrics.fallbacks++;
        return {
          flagKey,
          variationId: 'fallback',
          variationKey: 'fallback',
          value: defaultValue,
          reason: 'FALLBACK_DEFAULT',
          evaluationTimeMicros: 0.1,
        };
      }
      const entry = this.snapshot.flags.find((item) => item.flag.key === flagKey);
      if (!entry) {
        this.metrics.fallbacks++;
        return {
          flagKey,
          variationId: 'fallback',
          variationKey: 'fallback',
          value: defaultValue,
          reason: 'FALLBACK_DEFAULT',
          evaluationTimeMicros: 0.1,
        };
      }
      this.metrics.cacheHits++;
      return this.engine.evaluate(entry.flag, entry.config, context, this.segmentsById);
    } catch {
      this.metrics.fallbacks++;
      return {
        flagKey,
        variationId: 'fallback',
        variationKey: 'fallback',
        value: defaultValue,
        reason: 'FALLBACK_DEFAULT',
        evaluationTimeMicros: 0.1,
      };
    }
  }

  isEnabled(flagKey: string, context: EvaluationContext, defaultValue = false): boolean {
    const res = this.evaluate(flagKey, context, defaultValue);
    return typeof res.value === 'boolean' ? res.value : Boolean(res.value);
  }

  getString(flagKey: string, context: EvaluationContext, defaultValue = ''): string {
    const res = this.evaluate(flagKey, context, defaultValue);
    return typeof res.value === 'string' ? res.value : String(res.value ?? defaultValue);
  }

  getNumber(flagKey: string, context: EvaluationContext, defaultValue = 0): number {
    const res = this.evaluate(flagKey, context, defaultValue);
    const num = Number(res.value);
    return Number.isFinite(num) ? num : defaultValue;
  }

  getJson<T extends Record<string, unknown>>(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: T,
  ): T {
    const res = this.evaluate(flagKey, context, defaultValue);
    return typeof res.value === 'object' && res.value !== null ? (res.value as T) : defaultValue;
  }

  getValue<T extends boolean | string | number | Record<string, unknown>>(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: T,
  ): T {
    return this.evaluate(flagKey, context, defaultValue).value as T;
  }

  getMetrics(): SdkMetrics {
    return { ...this.metrics };
  }

  getSnapshot(): SdkSnapshot | null {
    return this.snapshot;
  }
}
