/**
 * Command Pattern — Versioned Configuration Changes & Rollback (FR5, FR7).
 *
 * Encapsulates mutations to FlagEnvironmentConfig with:
 * - Before/after snapshot capture
 * - Monotonic version increment
 * - Automatic fullRolloutSince hygiene tracking
 * - Audit log recording
 * - Observer notification via eventBus (SSE push)
 */

import type {
  FlagEnvironmentConfig,
  FlagVersion,
  PublicUser,
} from '../src/types/flagship';
import { eventBus } from './eventBus';
import { store } from './store';

export interface FlagCommand<TResult = FlagEnvironmentConfig> {
  execute(): TResult;
}

export class ApplyFlagConfigCommand implements FlagCommand<FlagEnvironmentConfig> {
  constructor(
    private readonly configId: string,
    private readonly patch: Partial<FlagEnvironmentConfig>,
    private readonly actor: PublicUser,
    private readonly reason: string,
    private readonly eventType: 'FLAG_CONFIG_UPDATED' | 'KILL_SWITCH_TOGGLED' | 'APPROVAL_RESOLVED' | 'SCHEDULE_EXECUTED' = 'FLAG_CONFIG_UPDATED',
  ) {}

  execute(): FlagEnvironmentConfig {
    const db = store.state;
    const idx = db.flagConfigs.findIndex((c) => c.id === this.configId);
    if (idx === -1) {
      throw new Error(`Flag configuration ${this.configId} not found`);
    }

    const before: FlagEnvironmentConfig = structuredClone(db.flagConfigs[idx]);
    const nowIso = new Date().toISOString();

    const nextRollout = this.patch.rolloutPercentage ?? before.rolloutPercentage;
    const nextEnabled = this.patch.enabled ?? before.enabled;
    let fullRolloutSince = before.fullRolloutSince;
    if (nextEnabled && nextRollout >= 100) {
      if (!fullRolloutSince) fullRolloutSince = nowIso;
    } else {
      fullRolloutSince = null;
    }

    const after: FlagEnvironmentConfig = {
      ...before,
      ...this.patch,
      id: before.id,
      flagId: before.flagId,
      environmentId: before.environmentId,
      version: before.version + 1,
      updatedAt: nowIso,
      updatedBy: this.actor.id,
      fullRolloutSince,
    };

    db.flagConfigs[idx] = after;

    const flag = db.flags.find((f) => f.id === before.flagId);
    const versionEntry: FlagVersion = {
      id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      flagId: before.flagId,
      environmentId: before.environmentId,
      version: after.version,
      authorId: this.actor.id,
      authorName: this.actor.name,
      reason: this.reason || 'Configuration updated',
      beforeSnapshot: before,
      afterSnapshot: structuredClone(after),
      createdAt: nowIso,
    };
    db.versions.unshift(versionEntry);

    db.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      actorId: this.actor.id,
      actorName: this.actor.name,
      actorRole: this.actor.role,
      action: this.eventType,
      entityType: 'FlagEnvironmentConfig',
      entityId: after.id,
      summary: `${flag?.key ?? after.flagId} v${after.version}: ${this.reason}`,
      timestamp: nowIso,
    });

    // Update connected SDK instance sync timestamps to reflect push propagation
    db.sdkInstances.forEach((inst) => {
      if (inst.environmentId === after.environmentId && inst.status === 'CONNECTED') {
        inst.lastSyncAt = nowIso;
        inst.lastSyncLatencyMs = inst.transport === 'SSE' ? 12 + Math.floor(Math.random() * 14) : 140;
      }
    });

    store.save();

    eventBus.publish({
      type: this.eventType,
      environmentId: after.environmentId,
      projectId: flag?.projectId,
      flagKey: flag?.key,
      summary: `${flag?.key ?? after.flagId} updated to v${after.version} (${this.reason})`,
    });

    return after;
  }
}

export class RollbackFlagConfigCommand implements FlagCommand<FlagEnvironmentConfig> {
  constructor(
    private readonly versionId: string,
    private readonly actor: PublicUser,
    private readonly reason: string,
  ) {}

  execute(): FlagEnvironmentConfig {
    const db = store.state;
    const targetVersion = db.versions.find((v) => v.id === this.versionId);
    if (!targetVersion) {
      throw new Error(`Version ${this.versionId} not found`);
    }

    const currentIdx = db.flagConfigs.findIndex(
      (c) => c.flagId === targetVersion.flagId && c.environmentId === targetVersion.environmentId,
    );
    if (currentIdx === -1) {
      throw new Error('Target environment configuration not found');
    }

    const before = structuredClone(db.flagConfigs[currentIdx]);
    const restored = structuredClone(targetVersion.afterSnapshot);
    const nowIso = new Date().toISOString();

    const after: FlagEnvironmentConfig = {
      ...restored,
      id: before.id,
      version: before.version + 1,
      updatedAt: nowIso,
      updatedBy: this.actor.id,
    };

    db.flagConfigs[currentIdx] = after;

    const flag = db.flags.find((f) => f.id === before.flagId);
    db.versions.unshift({
      id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      flagId: before.flagId,
      environmentId: before.environmentId,
      version: after.version,
      authorId: this.actor.id,
      authorName: this.actor.name,
      reason: this.reason || `Rolled back to version v${targetVersion.version}`,
      beforeSnapshot: before,
      afterSnapshot: structuredClone(after),
      createdAt: nowIso,
    });

    db.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      actorId: this.actor.id,
      actorName: this.actor.name,
      actorRole: this.actor.role,
      action: 'FLAG_ROLLED_BACK',
      entityType: 'FlagEnvironmentConfig',
      entityId: after.id,
      summary: `Rolled back ${flag?.key ?? after.flagId} to v${targetVersion.version} (now v${after.version})`,
      timestamp: nowIso,
    });

    store.save();

    eventBus.publish({
      type: 'FLAG_ROLLED_BACK',
      environmentId: after.environmentId,
      projectId: flag?.projectId,
      flagKey: flag?.key,
      summary: `Rolled back ${flag?.key ?? after.flagId} to v${targetVersion.version}`,
    });

    return after;
  }
}
