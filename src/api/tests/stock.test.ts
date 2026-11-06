import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { seedCatalog } from './helpers/fixtures.js';

let t: TestApp;
let staff: string;
let viewer: string;
let ids: Awaited<ReturnType<typeof seedCatalog>>;
beforeAll(async () => {
  t = await buildTestApp();
  staff = await t.token('staff');
  viewer = await t.token('viewer');
  ids = await seedCatalog(t, staff);
});
afterAll(async () => { await t.close(); });
const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe('stock operations', () => {
  it('receive increases stock and writes the ledger', async () => {
    const res = await request(t.app).post('/api/stock/receive').set(auth(staff))
      .send({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 20, reason: 'PO-1', reference: 'PO-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 20, sku: 'TEE', warehouseCode: 'MAIN' });
    const product = await request(t.app).get(`/api/products/${ids.tee.id}`).set(auth(viewer));
    expect(product.body.totalQuantity).toBe(20);
  });

  it('issue decreases stock and refuses to go negative', async () => {
    const ok = await request(t.app).post('/api/stock/issue').set(auth(staff)).send({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 5 });
    expect(ok.body.quantity).toBe(15);
    const tooMuch = await request(t.app).post('/api/stock/issue').set(auth(staff)).send({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 16 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(tooMuch.body.error.details).toMatchObject({ available: 15, requested: 16 });
  });

  it('adjust sets an absolute count', async () => {
    const res = await request(t.app).post('/api/stock/adjust').set(auth(staff))
      .send({ productId: ids.tee.id, warehouseId: ids.main.id, newQuantity: 12, reason: 'cycle count' });
    expect(res.body.quantity).toBe(12);
    expect((await request(t.app).post('/api/stock/adjust').set(auth(staff))
      .send({ productId: ids.tee.id, warehouseId: ids.main.id, newQuantity: 1 })).status).toBe(400); // reason required
  });

  it('transfer moves stock between warehouses atomically', async () => {
    const res = await request(t.app).post('/api/stock/transfer').set(auth(staff))
      .send({ productId: ids.tee.id, fromWarehouseId: ids.main.id, toWarehouseId: ids.shop.id, quantity: 4 });
    expect(res.status).toBe(200);
    expect(res.body.from.quantity).toBe(8);
    expect(res.body.to.quantity).toBe(4);
    const fail = await request(t.app).post('/api/stock/transfer').set(auth(staff))
      .send({ productId: ids.tee.id, fromWarehouseId: ids.main.id, toWarehouseId: ids.shop.id, quantity: 99 });
    expect(fail.status).toBe(409);
    const same = await request(t.app).post('/api/stock/transfer').set(auth(staff))
      .send({ productId: ids.tee.id, fromWarehouseId: ids.main.id, toWarehouseId: ids.main.id, quantity: 1 });
    expect(same.status).toBe(400);
    const levels = await request(t.app).get(`/api/stock?productId=${ids.tee.id}`).set(auth(viewer));
    expect(levels.body.map((l: { warehouseCode: string; quantity: number }) => [l.warehouseCode, l.quantity])).toEqual([['MAIN', 8], ['SHOP', 4]]);
  });

  it('records every movement with balances, newest first', async () => {
    const res = await request(t.app).get(`/api/stock/movements?productId=${ids.tee.id}`).set(auth(viewer));
    expect(res.body.map((m: { type: string; quantityDelta: number; balanceAfter: number }) => [m.type, m.quantityDelta, m.balanceAfter])).toEqual([
      ['TRANSFER_IN', 4, 4], ['TRANSFER_OUT', -4, 8], ['ADJUST', -3, 12], ['OUT', -5, 15], ['IN', 20, 20],
    ]);
    expect(res.body[4].userId).toEqual(expect.any(String));
  });

  it('404s for unknown product or warehouse, 403 for viewers, 400 for bad qty', async () => {
    expect((await request(t.app).post('/api/stock/receive').set(auth(staff))
      .send({ productId: '00000000-0000-0000-0000-000000000000', warehouseId: ids.main.id, quantity: 1 })).status).toBe(404);
    expect((await request(t.app).post('/api/stock/receive').set(auth(viewer))
      .send({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 1 })).status).toBe(403);
    expect((await request(t.app).post('/api/stock/receive').set(auth(staff))
      .send({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 0 })).status).toBe(400);
  });

  it('never oversells under concurrent requests', async () => {
    await request(t.app).post('/api/stock/receive').set(auth(staff)).send({ productId: ids.mug.id, warehouseId: ids.main.id, quantity: 10 });
    const results = await Promise.all(Array.from({ length: 25 }, () =>
      t.c.stock.issue({ productId: ids.mug.id, warehouseId: ids.main.id, quantity: 1 }, null).then(() => 'ok', () => 'fail')));
    expect(results.filter((r) => r === 'ok')).toHaveLength(10);
    const levels = await t.c.stock.levels({ productId: ids.mug.id });
    expect(levels[0]!.quantity).toBe(0);
  });

  it('notifies observers after commit', async () => {
    const seen: unknown[] = [];
    t.c.stock.onChanged((changes) => { seen.push(...changes); });
    await t.c.stock.receive({ productId: ids.mug.id, warehouseId: ids.shop.id, quantity: 3 }, null);
    expect(seen).toEqual([{ productId: ids.mug.id, warehouseId: ids.shop.id, quantity: 3 }]);
  });
});
