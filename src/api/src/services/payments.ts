import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Logger } from 'pino';
import { withTx } from '../db/tx.js';
import { ConflictError, NotConfiguredError, NotFoundError } from '../domain/errors.js';
import type { Payment } from '../domain/types.js';
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
}
