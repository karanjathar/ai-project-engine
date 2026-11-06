import type { RealtimeEvent } from './types';
import { getToken } from './client';

export type StreamStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to /api/events. Uses fetch streaming (not EventSource) so the JWT travels in the
 * Authorization header instead of the URL. Reconnects with capped exponential backoff.
 */
export function subscribeEvents(onEvent: (e: RealtimeEvent) => void, onStatus: (s: StreamStatus) => void = () => {}): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      const token = getToken();
      if (!token) { onStatus('offline'); return; }
      controller = new AbortController();
      onStatus('connecting');
      try {
        const res = await fetch('/api/events', { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        onStatus('live');
        attempt = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              try { onEvent(JSON.parse(line.slice(6)) as RealtimeEvent); } catch { /* ignore malformed frame */ }
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      onStatus('offline');
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
    }
  };
  void run();
  return () => { stopped = true; controller?.abort(); };
}
