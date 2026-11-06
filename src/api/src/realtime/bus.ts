import type { RealtimeEvent } from '../domain/types.js';

export type Listener = (e: RealtimeEvent) => void;

/**
 * In-process pub/sub for dashboard events. Single-replica by design; swap for Azure Web PubSub
 * (or Postgres LISTEN/NOTIFY) to fan out across replicas.
 */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  publish(e: RealtimeEvent): void {
    for (const fn of this.listeners) {
      try { fn(e); } catch { /* a broken subscriber must not affect others */ }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
