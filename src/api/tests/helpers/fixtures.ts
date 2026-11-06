import request from 'supertest';
import type { TestApp } from './app.js';

export async function seedCatalog(t: TestApp, staff: string) {
  const h = { authorization: `Bearer ${staff}` };
  const main = (await request(t.app).post('/api/warehouses').set(h).send({ code: 'MAIN', name: 'Main' })).body;
  const shop = (await request(t.app).post('/api/warehouses').set(h).send({ code: 'SHOP', name: 'Shop Floor' })).body;
  const tee = (await request(t.app).post('/api/products').set(h).send({ sku: 'TEE', name: 'T-Shirt', priceCents: 1500, reorderLevel: 5 })).body;
  const mug = (await request(t.app).post('/api/products').set(h).send({ sku: 'MUG', name: 'Mug', priceCents: 800, reorderLevel: 0 })).body;
  return { main, shop, tee, mug } as { main: { id: string }; shop: { id: string }; tee: { id: string }; mug: { id: string } };
}
