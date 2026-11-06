import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let staff: string;
let viewer: string;
beforeAll(async () => {
  t = await buildTestApp();
  staff = await t.token('staff');
  viewer = await t.token('viewer');
});
afterAll(async () => { await t.close(); });

const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe('categories', () => {
  it('staff create, everyone lists, viewers cannot write', async () => {
    const res = await request(t.app).post('/api/categories').set(auth(staff)).send({ name: 'Apparel' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: expect.any(String), name: 'Apparel' });
    expect((await request(t.app).post('/api/categories').set(auth(viewer)).send({ name: 'X' })).status).toBe(403);
    const list = await request(t.app).get('/api/categories').set(auth(viewer));
    expect(list.body).toHaveLength(1);
    expect((await request(t.app).post('/api/categories').set(auth(staff)).send({ name: 'Apparel' })).status).toBe(409);
  });
});

describe('products', () => {
  let categoryId: string;
  let productId: string;
  beforeAll(async () => {
    categoryId = (await request(t.app).get('/api/categories').set(auth(staff))).body[0].id;
  });

  it('creates a product with normalised SKU and custom attributes', async () => {
    const res = await request(t.app).post('/api/products').set(auth(staff)).send({
      sku: ' tshirt-red-m ', name: 'Red T-Shirt (M)', priceCents: 1999, reorderLevel: 5, categoryId,
      attributes: { color: 'red', size: 'M' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sku: 'TSHIRT-RED-M', name: 'Red T-Shirt (M)', priceCents: 1999, reorderLevel: 5, unit: 'pcs',
      categoryId, attributes: { color: 'red', size: 'M' }, isActive: true, totalQuantity: 0, imageUrl: null,
    });
    productId = res.body.id;
  });

  it('rejects duplicate SKU, invalid SKU and negative price', async () => {
    expect((await request(t.app).post('/api/products').set(auth(staff)).send({ sku: 'TSHIRT-RED-M', name: 'x', priceCents: 1 })).status).toBe(409);
    expect((await request(t.app).post('/api/products').set(auth(staff)).send({ sku: 'has space', name: 'x', priceCents: 1 })).status).toBe(400);
    expect((await request(t.app).post('/api/products').set(auth(staff)).send({ sku: 'OK1', name: 'x', priceCents: -1 })).status).toBe(400);
  });

  it('gets, patches and searches', async () => {
    const got = await request(t.app).get(`/api/products/${productId}`).set(auth(viewer));
    expect(got.body.sku).toBe('TSHIRT-RED-M');
    const patched = await request(t.app).patch(`/api/products/${productId}`).set(auth(staff))
      .send({ priceCents: 2499, attributes: { color: 'red', size: 'M', material: 'cotton' } });
    expect(patched.status).toBe(200);
    expect(patched.body.priceCents).toBe(2499);
    expect(patched.body.attributes.material).toBe('cotton');
    expect(patched.body.updatedAt >= got.body.updatedAt).toBe(true);
    await request(t.app).post('/api/products').set(auth(staff)).send({ sku: 'MUG-01', name: 'Coffee Mug', priceCents: 899 });
    const search = await request(t.app).get('/api/products?search=mug').set(auth(viewer));
    expect(search.body.map((p: { sku: string }) => p.sku)).toEqual(['MUG-01']);
    const byCat = await request(t.app).get(`/api/products?categoryId=${categoryId}`).set(auth(viewer));
    expect(byCat.body).toHaveLength(1);
    const low = await request(t.app).get('/api/products?lowStock=true').set(auth(viewer));
    expect(low.body.map((p: { sku: string }) => p.sku)).toEqual(['TSHIRT-RED-M']); // 0 <= 5; MUG reorder 0 → 0<=0 excluded
  });

  it('returns 404 for unknown or malformed ids and deletes', async () => {
    expect((await request(t.app).get('/api/products/00000000-0000-0000-0000-000000000000').set(auth(viewer))).status).toBe(404);
    expect((await request(t.app).get('/api/products/not-a-uuid').set(auth(viewer))).status).toBe(404);
    const mug = (await request(t.app).get('/api/products?search=MUG').set(auth(viewer))).body[0];
    expect((await request(t.app).delete(`/api/products/${mug.id}`).set(auth(staff))).status).toBe(204);
    expect((await request(t.app).get(`/api/products/${mug.id}`).set(auth(viewer))).status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await request(t.app).get('/api/products')).status).toBe(401);
  });
});
