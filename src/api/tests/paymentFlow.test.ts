import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { seedCatalog } from './helpers/fixtures.js';
import { fakeRazorpay, paidLinkEvent, signedRazorpayWebhook } from './helpers/fakeRazorpay.js';
import type { BotReply } from '../src/channels/reply.js';

const RZP = { RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'ks', RAZORPAY_WEBHOOK_SECRET: 'whsec', PUBLIC_BASE_URL: 'https://shop.example.com' };
let t: TestApp;
let rz: ReturnType<typeof fakeRazorpay>;
let ids: Awaited<ReturnType<typeof seedCatalog>>;
let staff: string;
const sent: { to: string; text: string }[] = [];
const replies: { to: string; reply: BotReply }[] = [];

const buyer = '919822220000';
const tap = (action: string, from = buyer) => t.c.bot.handle({ channel: 'whatsapp', from, text: action, action, senderName: 'Priya' });
const toBuyer = (who = buyer) => [...sent.filter((m) => m.to === who).map((m) => m.text), ...replies.filter((r) => r.to === who).map((r) => r.reply.text)];
const pay = (plink: string, amount: number, eventId: string) => signedRazorpayWebhook(t.app, paidLinkEvent(plink, amount), { eventId });

/** Buyer fills the cart with `qty` tees and taps "Pay online"; returns the created order and the bot reply. */
async function checkoutOnline(qty: number, who = buyer) {
  await tap(`qty:${ids.tee.id}:${qty}`, who);
  const reply = await tap('pay:online', who);
  const customer = await t.c.customers.findOrCreateByChannel('whatsapp', who, 'Priya');
  const [order] = await t.c.orders.list({ customerId: customer.id, limit: 1 });
  return { reply, order: order! };
}

beforeAll(async () => {
  rz = fakeRazorpay();
  t = await buildTestApp(RZP, {
    fetch: rz.fn,
    messenger: {
      send: async (_c, to, text) => { sent.push({ to, text }); },
      reply: async (_c, to, reply) => { replies.push({ to, reply }); },
    },
  });
  staff = await t.token('staff');
  ids = await seedCatalog(t, staff); // TEE ₹15.00
  await t.c.stock.receive({ productId: ids.tee.id, warehouseId: ids.main.id, quantity: 30 }, null);
  await t.c.settings.update({ currency: 'INR', businessName: 'Corner Shop', defaultWarehouseId: ids.main.id });
});
afterAll(async () => { await t.close(); });

describe('chat checkout with online payment (T37)', () => {
  it('checkout offers both methods; pay:online creates an ONLINE order and replies with a Pay button', async () => {
    await tap(`qty:${ids.tee.id}:2`);
    expect((await tap('checkout')).buttons?.map((b) => b.id)).toEqual(['pay:online', 'pay:cod', 'cart']);
    const { reply, order } = await checkoutOnline(1); // adds 1 more → 3 in cart
    expect(order).toMatchObject({ paymentMethod: 'ONLINE', paymentStatus: 'UNPAID', totalCents: 4500 });
    expect(reply.text).toContain(`Order #${order.number}`);
    expect(reply.text).toContain('₹45.00');
    expect(reply.link).toEqual({ label: 'Pay ₹45.00', url: expect.stringMatching(/^https:\/\/rzp\.io\/i\/link\d+$/) });
    const open = await t.pool.query("SELECT amount_cents, status FROM payments WHERE order_id = $1", [order.id]);
    expect(open.rows).toEqual([{ amount_cents: 4500, status: 'CREATED' }]);
    expect((await t.c.carts.get((await t.c.customers.findOrCreateByChannel('whatsapp', buyer, 'Priya')).id)).lines).toEqual([]);
  });

  it('when the payment provider is down the order still exists and the customer can retry', async () => {
    rz.setFailing(true);
    const who = '919822220001';
    const { reply, order } = await checkoutOnline(1, who);
    expect(order.paymentMethod).toBe('ONLINE');
    expect(reply.link).toBeUndefined();
    expect(reply.text).toMatch(/couldn't create the payment link/i);
    expect(reply.buttons?.map((b) => b.id)).toEqual([`paylink:${order.number}`, 'orders']);
    rz.setFailing(false);
    const retry = await tap(`paylink:${order.number}`, who);
    expect(retry.link?.url).toMatch(/^https:\/\/rzp\.io\/i\/link\d+$/);
  });
});

describe('paylink action (T37)', () => {
  it('resends the same open link for my own unpaid online order', async () => {
    const who = '919822220002';
    const { reply, order } = await checkoutOnline(1, who);
    const again = await tap(`paylink:${order.number}`, who);
    expect(again.link?.url).toBe(reply.link?.url);
  });

  it('never reveals or resends other customers’ orders', async () => {
    const { order } = await checkoutOnline(1, '919822220003');
    expect((await tap(`paylink:${order.number}`, '919822220004')).text).toMatch(/couldn't find that order/i);
  });

  it('explains paid, cash-on-delivery and cancelled orders instead of creating links', async () => {
    const who = '919822220005';
    const online = await checkoutOnline(1, who);
    await pay((await t.pool.query('SELECT provider_ref FROM payments WHERE order_id = $1', [online.order.id])).rows[0].provider_ref, 1500, 'evt_pf_1');
    expect((await tap(`paylink:${online.order.number}`, who)).text).toMatch(/already paid/i);

    await tap(`qty:${ids.tee.id}:1`, who);
    await tap('pay:cod', who);
    const cod = (await t.c.orders.list({ customerId: (await t.c.customers.findOrCreateByChannel('whatsapp', who, 'Priya')).id, limit: 1 }))[0]!;
    expect((await tap(`paylink:${cod.number}`, who)).text).toMatch(/cash on delivery/i);

    await t.c.orders.cancel(cod.id, null);
    expect((await tap(`paylink:${cod.number}`, who)).text).toMatch(/was cancelled/i);
  });
});

describe('customer messages on payment (T37)', () => {
  it('a verified payment sends ONE "payment received · confirmed" message', async () => {
    const who = '919822220006';
    const { order } = await checkoutOnline(2, who);
    const plink = (await t.pool.query('SELECT provider_ref FROM payments WHERE order_id = $1', [order.id])).rows[0].provider_ref as string;
    const before = toBuyer(who).length;
    expect((await pay(plink, 3000, 'evt_pf_2')).status).toBe(200);
    const msgs = toBuyer(who).slice(before);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/payment of ₹30\.00 received/i);
    expect(msgs[0]).toContain(`#${order.number}`);
    expect(msgs[0]).toMatch(/confirmed/i);
    expect(await t.c.orders.get(order.id)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    await pay(plink, 3000, 'evt_pf_2b'); // re-delivery → no second message
    expect(toBuyer(who).slice(before)).toHaveLength(1);
  });

  it('paid but unfulfillable → the customer is told a refund is coming', async () => {
    const who = '919822220007';
    await t.c.stock.receive({ productId: ids.mug.id, warehouseId: ids.main.id, quantity: 1 }, null);
    await tap(`qty:${ids.mug.id}:1`, who);
    await tap('pay:online', who);
    const customer = await t.c.customers.findOrCreateByChannel('whatsapp', who, 'Priya');
    const [order] = await t.c.orders.list({ customerId: customer.id, limit: 1 });
    await t.c.stock.issue({ productId: ids.mug.id, warehouseId: ids.main.id, quantity: 1 }, null); // sold elsewhere meanwhile
    const plink = (await t.pool.query('SELECT provider_ref FROM payments WHERE order_id = $1', [order!.id])).rows[0].provider_ref as string;
    await pay(plink, 800, 'evt_pf_3');
    expect(toBuyer(who).at(-1)).toMatch(new RegExp(`#${order!.number}.*refund`, 'i'));
    expect((await t.c.orders.get(order!.id))!.paymentStatus).toBe('REFUND_DUE');
  });
});

describe('POST /api/orders/:id/payment-link (T37)', () => {
  const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });
  const newOrder = async (who: string) => {
    const customerId = (await t.c.customers.findOrCreateByChannel('whatsapp', who, 'Staff Target')).id;
    return t.c.orders.create({ customerId, channel: 'whatsapp', items: [{ productId: ids.tee.id, quantity: 1 }] });
  };

  it('returns the link and optionally sends it to the customer’s chat', async () => {
    const who = '919822220008';
    const order = await newOrder(who);
    const quiet = await request(t.app).post(`/api/orders/${order.id}/payment-link`).set(auth(staff)).send({});
    expect(quiet.status).toBe(200);
    expect(quiet.body).toMatchObject({ url: expect.stringMatching(/^https:\/\/rzp\.io\/i\//), notified: false });
    expect(new Date(quiet.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(toBuyer(who)).toEqual([]);
    const loud = await request(t.app).post(`/api/orders/${order.id}/payment-link`).set(auth(staff)).send({ notify: true });
    expect(loud.body).toMatchObject({ url: quiet.body.url, notified: true });
    expect(replies.find((r) => r.to === who)!.reply.link).toMatchObject({ url: quiet.body.url });
    expect((await t.c.orders.get(order.id))!.paymentMethod).toBe('ONLINE'); // COD order switched by staff request
  });

  it('is staff-only, validates, and maps provider failure to 502 and paid orders to 409', async () => {
    const order = await newOrder('919822220009');
    expect((await request(t.app).post(`/api/orders/${order.id}/payment-link`).set(auth(await t.token('viewer'))).send({})).status).toBe(403);
    expect((await request(t.app).post(`/api/orders/${order.id}/payment-link`).set(auth(staff)).send({ notify: 'yes' })).status).toBe(400);
    expect((await request(t.app).post('/api/orders/00000000-0000-0000-0000-000000000000/payment-link').set(auth(staff)).send({})).status).toBe(404);
    rz.setFailing(true);
    const down = await request(t.app).post(`/api/orders/${order.id}/payment-link`).set(auth(staff)).send({});
    rz.setFailing(false);
    expect(down.status).toBe(502);
    expect(JSON.stringify(down.body)).not.toMatch(/maintenance|rzp_test_x|Basic /);
    expect(down.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    await t.pool.query("UPDATE orders SET payment_status = 'PAID' WHERE id = $1", [order.id]);
    expect((await request(t.app).post(`/api/orders/${order.id}/payment-link`).set(auth(staff)).send({})).status).toBe(409);
  });
});
