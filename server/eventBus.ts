/**
 * Observer Pattern — Configuration Change Event Bus & SSE Broadcaster (FR5, QA3).
 *
 * Subscribers:
 * - Connected SDK instances via `/api/v1/sdk/stream` (filtered by environmentId or global)
 * - Dashboard live feed via `/api/v1/sdk/stream?scope=dashboard`
 */

import type { Response } from 'express';

export interface FlagShipDomainEvent {
  id: string;
  type:
    | 'FLAG_CONFIG_UPDATED'
    | 'KILL_SWITCH_TOGGLED'
    | 'APPROVAL_RESOLVED'
    | 'FLAG_ROLLED_BACK'
    | 'SCHEDULE_EXECUTED'
    | 'HEARTBEAT';
  environmentId?: string;
  projectId?: string;
  flagKey?: string;
  revision: number;
  summary: string;
  publishedAt: string;
}

export interface SseSubscriber {
  id: string;
  res: Response;
  environmentId?: string;
  clientName: string;
  connectedAt: string;
}

class FlagShipEventBus {
  private readonly subscribers = new Map<string, SseSubscriber>();
  private revisionCounter = 100;
  private recentEvents: FlagShipDomainEvent[] = [];

  addSubscriber(sub: SseSubscriber): void {
    this.subscribers.set(sub.id, sub);
  }

  removeSubscriber(id: string): void {
    this.subscribers.delete(id);
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getRevision(): number {
    return this.revisionCounter;
  }

  getRecentEvents(): FlagShipDomainEvent[] {
    return this.recentEvents.slice(0, 25);
  }

  publish(event: Omit<FlagShipDomainEvent, 'id' | 'revision' | 'publishedAt'>): FlagShipDomainEvent {
    this.revisionCounter += 1;
    const fullEvent: FlagShipDomainEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      revision: this.revisionCounter,
      publishedAt: new Date().toISOString(),
    };

    this.recentEvents.unshift(fullEvent);
    if (this.recentEvents.length > 50) {
      this.recentEvents = this.recentEvents.slice(0, 50);
    }

    const payload = `id: ${fullEvent.id}\nevent: ${fullEvent.type}\ndata: ${JSON.stringify(fullEvent)}\n\n`;

    for (const [id, sub] of this.subscribers.entries()) {
      if (sub.environmentId && fullEvent.environmentId && sub.environmentId !== fullEvent.environmentId) {
        continue;
      }
      try {
        sub.res.write(payload);
      } catch {
        this.subscribers.delete(id);
      }
    }

    return fullEvent;
  }
}

export const eventBus = new FlagShipEventBus();
