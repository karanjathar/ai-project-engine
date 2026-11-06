import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { seedCatalog } from './helpers/fixtures.js';
import { EventBus } from '../src/realtime/bus.js';
import type { RealtimeEvent } from '../src/domain/types.js';

let t: TestApp;
let server: Server;
let base: string;
beforeAll(async () => {
  t = await buildTestApp();
  server = t.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); server.close(); await t.close(); });

describe('EventBus', () => {
  it('delivers to subscribers until they unsubscribe and isolates failures', () => {
    const bus = new EventBus();
    const got: RealtimeEvent[] = [];
    bus.subscribe(() => { throw new Error('bad listener'); });
    const off = bus.subscribe((e) => got.push(e));
    const e: RealtimeEvent = { type: 'order.created', orderId: 'x', number: 1, status: 'PENDING' };
    bus.publish(e);
    off();
    bus.publish(e);
    expect(got).toEqual([e]);
    expect(bus.size).toBe(1);
  });
});

describe('GET /api/events (SSE)', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
  });

  it('streams stock.changed events with the new total', async () => {
    const staff = await t.token('staff');
    const ids = await seedCatalog(t, staff);
    const ac = new AbortController();
    const res = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${staff}` }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain(': connected');

    await t.c.stock.receive({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 7 }, null);
    while (!buf.includes('stock.changed')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    const line = buf.split('\n').find((l) => l.startsWith('data: ') && l.includes('stock.changed'))!;
    expect(JSON.parse(line.slice(6))).toEqual({
      type: 'stock.changed', productId: ids.tee.id, sku: 'TEE', warehouseId: ids.main.id, quantity: 7, totalQuantity: 7,
    });
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(t.c.events.size).toBe(0);
  });
});
