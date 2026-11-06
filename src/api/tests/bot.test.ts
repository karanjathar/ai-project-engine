import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { seedCatalog } from './helpers/fixtures.js';
import type { InboundMessage, RealtimeEvent } from '../src/domain/types.js';

let t: TestApp;
let ids: Awaited<ReturnType<typeof seedCatalog>>;
const sent: { channel: string; to: string; text: string }[] = [];
const events: RealtimeEvent[] = [];

beforeAll(async () => {
  t = await buildTestApp({}, { messenger: { send: async (channel, to, text) => { sent.push({ channel, to, text }); } } });
  ids = await seedCatalog(t, await t.token('staff'));
  await t.c.stock.receive({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 9 }, null);
  await t.c.settings.update({ currency: 'INR', businessName: 'Corner Shop' });
  t.c.events.subscribe((e) => events.push(e));
});
afterAll(async () => { await t.close(); });

const wa = (text: string, from = '15551230000'): InboundMessage => ({ channel: 'whatsapp', from, text, senderName: 'Asha' });

describe('bot commands', () => {
  it('help and unknown input show the command list', async () => {
    for (const text of ['help', 'HI', 'what?']) {
      const reply = await t.c.bot.handle(wa(text));
      expect(reply).toContain('Corner Shop');
      expect(reply).toContain('stock <SKU>');
    }
  });

  it('stock and price lookups (case-insensitive SKU)', async () => {
    expect(await t.c.bot.handle(wa('stock tee'))).toMatch(/T-Shirt \(TEE\): 9 pcs available/);
    expect(await t.c.bot.handle(wa('Price TEE'))).toContain('₹15.00');
    expect(await t.c.bot.handle(wa('stock NOPE'))).toMatch(/couldn't find.*NOPE/i);
  });

  it('catalog lists in-stock active products only', async () => {
    const reply = await t.c.bot.handle(wa('catalog'));
    expect(reply).toContain('TEE');
    expect(reply).not.toContain('MUG'); // zero stock
  });

  it('order creates a PENDING order for the chat customer', async () => {
    const reply = await t.c.bot.handle(wa('order tee 2'));
    expect(reply).toMatch(/Order #\d+ received/);
    expect(reply).toContain('₹30.00');
    const [order] = await t.c.orders.list({ status: 'PENDING' });
    expect(order).toMatchObject({ channel: 'whatsapp', customerName: 'Asha', totalCents: 3000 });
    expect(await t.c.bot.handle(wa('order tee 50'))).toMatch(/only have 9 pcs/i);
    expect(await t.c.bot.handle(wa('order tee 0'))).toContain('order <SKU> <qty>');
  });

  it('status only reveals the customer’s own orders', async () => {
    const [order] = await t.c.orders.list({ status: 'PENDING' });
    expect(await t.c.bot.handle(wa(`status ${order!.number}`))).toContain('PENDING');
    expect(await t.c.bot.handle(wa(`status ${order!.number}`, '19990000000'))).toMatch(/couldn't find order/i);
  });
});

describe('inbound pipeline', () => {
  it('logs, publishes, replies once and ignores retries', async () => {
    sent.length = 0;
    const msg: InboundMessage = { ...wa('stock tee'), externalId: 'wamid.ABC' };
    await t.c.inbox.receive(msg);
    await t.c.inbox.receive(msg);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'whatsapp', to: '15551230000' });
    expect(events.filter((e) => e.type === 'message.received')).toHaveLength(1);
    const log = await t.c.messages.list({ channel: 'whatsapp' });
    expect(log.filter((m) => m.direction === 'in')).toHaveLength(1);
  });
});
