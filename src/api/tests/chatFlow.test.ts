import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/app.js';
import type { InboundMessage } from '../src/domain/types.js';
import type { BotReply } from '../src/channels/reply.js';

let t: TestApp;
const id: Record<string, string> = {};
const tap = (action: string, from = '919800000001'): Promise<BotReply> =>
  t.c.bot.handle({ channel: 'whatsapp', from, text: action, action, senderName: 'Meera' } satisfies InboundMessage);
const rows = (r: BotReply) => r.list?.sections.flatMap((s) => s.rows) ?? [];

beforeAll(async () => {
  t = await buildTestApp();
  const h = { authorization: `Bearer ${await t.token('staff')}` };
  const post = async (path: string, body: object) => (await request(t.app).post(path).set(h).send(body)).body as { id: string };
  id.wh = (await post('/api/warehouses', { code: 'MAIN', name: 'Main' })).id;
  id.apparel = (await post('/api/categories', { name: 'Apparel' })).id;
  id.home = (await post('/api/categories', { name: 'Home' })).id;
  await post('/api/categories', { name: 'Empty' });
  id.tee = (await post('/api/products', { sku: 'TEE', name: 'Red T-Shirt', priceCents: 49900, categoryId: id.apparel, description: 'Soft cotton', attributes: { size: 'M' } })).id;
  id.cap = (await post('/api/products', { sku: 'CAP', name: 'Cap', priceCents: 39900, categoryId: id.apparel })).id; // no stock
  id.mug = (await post('/api/products', { sku: 'MUG', name: 'Mug', priceCents: 29900, categoryId: id.home })).id;
  for (let i = 1; i <= 11; i++) {
    const p = await post('/api/products', { sku: `SOCK-${i}`, name: `Sock ${String(i).padStart(2, '0')}`, priceCents: 9900, categoryId: id.apparel });
    await t.c.stock.receive({ productId: p.id, warehouseId: id.wh, quantity: 2 }, null);
  }
  await t.c.stock.receive({ productId: id.tee, warehouseId: id.wh, quantity: 3 }, null);
  await t.c.stock.receive({ productId: id.mug, warehouseId: id.wh, quantity: 20 }, null);
  await t.c.settings.update({ businessName: 'Corner Shop', currency: 'INR' });
});
afterAll(async () => { await t.close(); });

describe('menu & browsing (T31)', () => {
  it('menu shows Browse / My cart / My orders buttons', async () => {
    const r = await tap('menu');
    expect(r.text).toContain('Corner Shop');
    expect(r.buttons?.map((b) => b.id)).toEqual(['catalog', 'cart', 'orders']);
  });

  it('catalog lists only categories with orderable products, plus All products', async () => {
    const r = await tap('catalog');
    expect(rows(r).map((x) => [x.id, x.title, x.description])).toEqual([
      [`cat:${id.apparel}:0`, 'Apparel', '12 products'],
      [`cat:${id.home}:0`, 'Home', '1 product'],
      ['cat:all:0', 'All products', '13 products'],
    ]);
  });

  it('category lists products 9 per page with a More… row', async () => {
    const page1 = rows(await tap(`cat:${id.apparel}:0`));
    expect(page1).toHaveLength(10);
    expect(page1[0]).toEqual({ id: `prod:${id.tee}`, title: 'Red T-Shirt', description: '₹499.00 · 3 left' });
    expect(page1.at(-1)).toEqual({ id: `cat:${id.apparel}:9`, title: 'More…', description: 'Show 3 more' });
    const page2 = rows(await tap(`cat:${id.apparel}:9`));
    expect(page2.map((x) => x.title)).toEqual(['Sock 09', 'Sock 10', 'Sock 11']);
    expect(page1.some((x) => x.title === 'Cap')).toBe(false); // out of stock
  });

  it('product detail shows price, stock, description and a quantity list capped at stock', async () => {
    const r = await tap(`prod:${id.tee}`);
    expect(r.text).toContain('Red T-Shirt');
    expect(r.text).toContain('₹499.00');
    expect(r.text).toContain('3 in stock');
    expect(r.text).toContain('Soft cotton');
    expect(r.text).toContain('size: M');
    expect(rows(r).map((x) => x.id)).toEqual([`qty:${id.tee}:1`, `qty:${id.tee}:2`, `qty:${id.tee}:3`]);
    expect(rows(await tap(`prod:${id.mug}`)).map((x) => x.title)).toEqual(['1', '2', '3', '4', '5', '10']);
  });

  it('adding to cart confirms with totals and next-step buttons', async () => {
    const r = await tap(`qty:${id.tee}:2`);
    expect(r.text).toContain('Added 2 × Red T-Shirt');
    expect(r.text).toContain('₹998.00');
    expect(r.buttons?.map((b) => b.id)).toEqual(['checkout', 'catalog', 'cart:clear']);
    const again = await tap(`qty:${id.tee}:5`);
    expect(again.text).toContain('only 3 available');
  });

  it('out-of-stock, unknown and malformed taps degrade gracefully', async () => {
    expect((await tap(`prod:${id.cap}`)).text).toMatch(/not available/i);
    expect((await tap(`qty:${id.cap}:1`)).text).toMatch(/not available/i);
    expect((await tap('prod:00000000-0000-0000-0000-000000000000')).buttons?.[0]!.id).toBe('catalog');
    expect((await tap('qty:not-a-uuid:2')).buttons?.map((b) => b.id)).toContain('catalog');
    expect((await tap(`cat:${id.apparel}:-5`)).list).toBeDefined();
  });

  it('typed v1 commands are unaffected', async () => {
    expect((await t.c.bot.handle({ channel: 'whatsapp', from: '919800000001', text: 'stock tee' })).text).toContain('Red T-Shirt (TEE): 3 pcs available') // carts don't reserve stock;
  });
});
