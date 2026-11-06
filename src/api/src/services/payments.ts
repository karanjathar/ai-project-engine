import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Logger } from 'pino';
import { withTx } from '../db/tx.js';
import { ConflictError, NotConfiguredError, NotFoundError } from '../domain/errors.js';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import type { Payment } from '../domain/types.js';
import type { EventBus } from '../realtime/bus.js';
import type { Messenger } from './messenger.js';
import type { RazorpayClient } from '../payments/razorpay.js';
import type { CustomersRepo } from '../repositories/customers.js';
import type { OrdersService } from './orders.js';
import type { SettingsService } from './settings.js';

export interface PaymentsConfig { razorpayConfigured: boolean; onlineAvailable: boolean; codEnabled: boolean; reason?: string }

const PAYMENT_COLS = `id, order_id AS "orderId", provider, provider_ref AS "providerRef", reference_id AS "referenceId", status,
  amount_cents AS "amountCents", currency, short_url AS "shortUrl", provider_payment_id AS "providerPaymentId",
  expires_at AS "expiresAt", created_at AS "createdAt"`;
/** Razorpay requires expire_by ≥ 15 minutes in the future; keep a safety margin. */
const MIN_EXPIRY_MINUTES = 16;

export class PaymentService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly razorpay: RazorpayClient,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly customers: CustomersRepo,
    private readonly publicBaseUrl: string,
    private readonly logger: Logger,
    private readonly events: EventBus,
    private readonly messenger: Messenger,
  ) {}

  async config(): Promise<PaymentsConfig> {
    const s = await this.settings.get();
    const razorpayConfigured = this.razorpay.isConfigured();
    const base = { razorpayConfigured, codEnabled: s.payments.codEnabled };
    if (!razorpayConfigured) return { ...base, onlineAvailable: false, reason: 'Razorpay keys are not configured on the server.' };
    if (!s.payments.onlineEnabled) return { ...base, onlineAvailable: false, reason: 'Online payments are disabled in Settings.' };
    if (s.currency !== 'INR') return { ...base, onlineAvailable: false, reason: `Razorpay Payment Links require the shop currency to be INR (currently ${s.currency}).` };
    return { ...base, onlineAvailable: true };
  }

  /**
   * Returns the order's open payment link, creating one if needed. Amount always comes from the order (server-side).
   * Serialised per order with an advisory lock, so concurrent callers never create two live links.
   */
  async linkForOrder(orderId: string): Promise<Payment> {
    const order = await this.orders.get(orderId);
    if (!order) throw new NotFoundError('Order');
    if (order.status === 'CANCELLED') throw new ConflictError('Order is cancelled');
    if (order.paymentStatus !== 'UNPAID') throw new ConflictError(`Order is already ${order.paymentStatus === 'PAID' ? 'paid' : 'awaiting a refund'}`);
    const cfg = await this.config();
    if (!cfg.onlineAvailable) throw new NotConfiguredError(`Online payments (${cfg.reason ?? 'unavailable'})`);
    const s = await this.settings.get();
    const customer = await this.customers.get(order.customerId);

    return withTx(this.pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payment-link:${orderId}`]);
      const open = await c.query<Payment>(`SELECT ${PAYMENT_COLS} FROM payments WHERE order_id = $1 AND status = 'CREATED'`, [orderId]);
      const current = open.rows[0];
      if (current && new Date(current.expiresAt).getTime() > Date.now() + 60_000) return current;
      if (current) {
        await c.query("UPDATE payments SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [current.id]);
        await this.razorpay.cancelPaymentLink(current.providerRef).catch((err: unknown) => this.logger.warn({ err: String(err) }, 'could not cancel stale payment link'));
      }
      const minutes = Math.max(s.payments.linkExpiryMinutes, MIN_EXPIRY_MINUTES);
      const expiresAt = new Date(Date.now() + minutes * 60_000);
      const referenceId = `ORD-${order.number}-${randomBytes(3).toString('hex')}`;
      const link = await this.razorpay.createPaymentLink({
        amountCents: order.totalCents,
        currency: s.currency,
        referenceId,
        description: `${s.businessName} order #${order.number}`,
        customer: { name: customer?.name ?? order.customerName, ...(customer?.phone ? { contact: customer.phone } : {}) },
        callbackUrl: `${this.publicBaseUrl.replace(/\/$/, '')}/shop/order/${order.publicToken}`,
        expireBy: expiresAt,
        notes: { order_id: order.id, order_number: String(order.number) },
      });
      const { rows } = await c.query<Payment>(
        `INSERT INTO payments (order_id, provider_ref, reference_id, status, amount_cents, currency, short_url, expires_at)
         VALUES ($1, $2, $3, 'CREATED', $4, $5, $6, $7) RETURNING ${PAYMENT_COLS}`,
        [orderId, link.id, referenceId, order.totalCents, s.currency, link.shortUrl, expiresAt]);
      if (order.paymentMethod !== 'ONLINE') {
        await c.query("UPDATE orders SET payment_method = 'ONLINE', updated_at = now() WHERE id = $1", [orderId]);
      }
      return rows[0]!;
    });
  }

  /**
   * Handles a signature-verified Razorpay webhook (D-003: the only source of truth for payment state).
   * Idempotent per event id; if processing fails the id is released so Razorpay's retry runs again.
   */
  async handleWebhook(eventId: string | undefined, rawBody: Buffer | undefined, body: unknown): Promise<void> {
    const id = eventId?.trim() || `body:${createHash('sha256').update(rawBody ?? Buffer.from(JSON.stringify(body ?? null))).digest('hex')}`;
    const claimed = await this.pool.query('INSERT INTO webhook_events (provider, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['razorpay', id]);
    if (!claimed.rowCount) return; // replay
    try {
      await this.process(body);
    } catch (err) {
      await this.pool.query('DELETE FROM webhook_events WHERE provider = $1 AND event_id = $2', ['razorpay', id]);
      throw err;
    }
  }

  private async process(body: unknown): Promise<void> {
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) return; // not an event we understand: acknowledge
    const { event, payload } = parsed.data;
    const link = payload.payment_link?.entity;
    if (!link) return;

    if (event === 'payment_link.expired' || event === 'payment_link.cancelled') {
      await this.pool.query(
        "UPDATE payments SET status = $2, updated_at = now() WHERE provider_ref = $1 AND status = 'CREATED'",
        [link.id, event === 'payment_link.expired' ? 'EXPIRED' : 'CANCELLED']);
      return;
    }
    if (event !== 'payment_link.paid') return;

    const paidCents = link.amount_paid ?? payload.payment?.entity.amount ?? 0;
    const settled = await withTx(this.pool, async (c) => {
      const p = await c.query<{ id: string; order_id: string; status: string; amount_cents: number }>(
        'SELECT id, order_id, status, amount_cents FROM payments WHERE provider_ref = $1 FOR UPDATE', [link.id]);
      const payment = p.rows[0];
      if (!payment) return undefined;            // unknown link: acknowledge
      const o = await c.query<{ status: string; payment_status: string }>('SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE', [payment.order_id]);
      const order = o.rows[0]!;
      // Already settled (a re-delivery, or a retry after a crash): don't touch money state again,
      // but report it so the confirm step below can still complete if it didn't finish last time.
      if (payment.status === 'PAID') return { orderId: payment.order_id, good: order.payment_status === 'PAID', fresh: false };
      await c.query("UPDATE payments SET status = 'PAID', provider_payment_id = $2, updated_at = now() WHERE id = $1",
        [payment.id, payload.payment?.entity.id ?? null]);
      // Money arrived. It is only "good" if the amount matches and the order can still be fulfilled.
      const good = paidCents === payment.amount_cents && order.status !== 'CANCELLED';
      await c.query('UPDATE orders SET payment_status = $2, updated_at = now() WHERE id = $1', [payment.order_id, good ? 'PAID' : 'REFUND_DUE']);
      return { orderId: payment.order_id, good, fresh: true };
    });
    if (!settled) return;

    let order = (await this.orders.get(settled.orderId))!;
    if (settled.fresh) this.events.publish({ type: 'payment.updated', orderId: order.id, number: order.number, paymentStatus: order.paymentStatus });
    if (!settled.good) {
      if (!settled.fresh) return; // staff were already alerted when it was first settled
      await this.alertStaff(`⚠️ Payment received for order #${order.number} but it needs attention (amount mismatch or order cancelled). Refund due in Razorpay.`);
      return;
    }
    if (order.status !== 'PENDING') return; // staff already confirmed it manually
    try {
      await this.orders.confirm(order.id, undefined, null); // auto-confirm from the default warehouse
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      await this.pool.query("UPDATE orders SET payment_status = 'REFUND_DUE', updated_at = now() WHERE id = $1", [order.id]);
      order = (await this.orders.get(order.id))!;
      this.events.publish({ type: 'payment.updated', orderId: order.id, number: order.number, paymentStatus: 'REFUND_DUE' });
      await this.alertStaff(`⚠️ Order #${order.number} was paid online but could not be confirmed (${err.message}). Please refund the customer in Razorpay.`);
    }
  }

  private async alertStaff(text: string): Promise<void> {
    const { alertRecipients } = await this.settings.get();
    for (const r of alertRecipients) {
      await this.messenger.send(r.channel, r.to, text).catch((err: unknown) => this.logger.warn({ err: String(err), channel: r.channel }, 'staff payment alert failed'));
    }
  }
}

// Permissive on purpose: only the fields we act on are checked (docs/3_SCHEMAS.md §3.11).
const webhookSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({ entity: z.object({ id: z.string(), amount_paid: z.number().optional() }) }).optional(),
    payment: z.object({ entity: z.object({ id: z.string(), amount: z.number().optional() }) }).optional(),
  }),
});
