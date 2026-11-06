import type { RequestHandler } from 'express';
import type { EventBus } from './bus.js';

const HEARTBEAT_MS = 25_000; // below typical proxy idle timeouts (Azure ingress: 240s)
const MAX_CLIENTS = 500;

export function sseHandler(bus: EventBus): RequestHandler {
  return (req, res) => {
    if (bus.size >= MAX_CLIENTS) {
      res.status(503).json({ error: { code: 'BUSY', message: 'Too many realtime connections' } });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n: connected\n\n');
    const off = bus.subscribe((e) => { res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); });
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => { clearInterval(beat); off(); });
  };
}
