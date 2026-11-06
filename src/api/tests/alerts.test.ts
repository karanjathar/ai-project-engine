import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { seedCatalog } from './helpers/fixtures.js';
import type { RealtimeEvent } from '../src/domain/types.js';

let t: TestApp;
let staff: string;
let ids: Awaited<ReturnType<typeof seedCatalog>>;
const sent: { channel: string; to: string; text: string }[] = [];
const events: RealtimeEvent[] = [];
beforeAll(async () => {
  t = await buildTestApp({}, { messenger: { send: async (channel, to, text) => { sent.push({ channel, to, text }); } } });
  staff = await t.token('staff');
  ids = await seedCatalog(t, staff); // TEE reorderLevel 5, MUG reorderLevel 0
  await t.c.settings.update({ alertRecipients: [{ channel: 'whatsapp', to: '15550009999' }, { channel: 'telegram', to: '42' }] });
  t.c.events.subscribe((e) => events.push(e));
});
afterAll(async () => { await t.close(); });

describe('low-stock alerts', () => {
  it('fires once when stock crosses down through the reorder level', async () => {
    await t.c.stock.receive({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 8 }, null);
    expect(sent).toHaveLength(0); // 0 -> 8: going up, no alert
    await t.c.stock.issue({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 2 }, null); // 6 > 5
    expect(sent).toHaveLength(0);
    await t.c.stock.issue({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 2 }, null); // 4 <= 5
    expect(sent.map((s) => s.channel)).toEqual(['whatsapp', 'telegram']);
    expect(sent[0]!.text).toContain('TEE');
    expect(sent[0]!.text).toContain('4');
    expect(events.filter((e) => e.type === 'stock.low')).toEqual([
      { type: 'stock.low', productId: ids.tee.id, sku: 'TEE', name: 'T-Shirt', totalQuantity: 4, reorderLevel: 5 },
    ]);
    await t.c.stock.issue({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 1 }, null); // already low
    expect(sent).toHaveLength(2);
  });

  it('ignores untracked products and transfers that keep the total unchanged', async () => {
    await t.c.stock.receive({ productId: ids.mug.id, warehouseId: ids.main.id, quantity: 1 }, null);
    await t.c.stock.issue({ productId: ids.mug.id, warehouseId: ids.main.id, quantity: 1 }, null);
    await t.c.stock.transfer({ productId: ids.tee.id, fromWarehouseId: ids.main.id, toWarehouseId: ids.shop.id, quantity: 1 }, null);
    expect(sent).toHaveLength(2);
  });
});

describe('GET /api/dashboard', () => {
  it('reports KPIs', async () => {
    const customerId = (await request(t.app).post('/api/customers').set({ authorization: `Bearer ${staff}` }).send({ name: 'C' })).body.id;
    await t.c.orders.create({ customerId, channel: 'manual', items: [{ productId: ids.mug.id, quantity: 1 }] });
    const res = await request(t.app).get('/api/dashboard').set({ authorization: `Bearer ${await t.token('viewer')}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ productCount: 2, totalUnits: 3, stockValueCents: 3 * 1500, lowStockCount: 1, pendingOrders: 1, ordersToday: 1 });
  });
});
