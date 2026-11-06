import type { InboundMessage, Order } from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import type { CustomersRepo } from '../repositories/customers.js';
import type { ProductsRepo } from '../repositories/products.js';
import type { OrdersService } from './orders.js';
import type { SettingsService } from './settings.js';

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Chat command engine shared by every channel. Returns the reply text. */
export class BotService {
  constructor(
    private readonly products: ProductsRepo,
    private readonly orders: OrdersService,
    private readonly customers: CustomersRepo,
    private readonly settings: SettingsService,
  ) {}

  async handle(msg: InboundMessage): Promise<string> {
    const s = await this.settings.get();
    const [cmd = '', ...args] = msg.text.trim().split(/\s+/);
    const money = (c: number) => formatMoney(c, s.currency);

    switch (cmd.toLowerCase()) {
      case 'stock': {
        const p = args[0] ? await this.products.getBySku(args[0]) : undefined;
        if (!p || !p.isActive) return this.unknownSku(args[0]);
        return `${p.name} (${p.sku}): ${p.totalQuantity} ${p.unit} available.`;
      }
      case 'price': {
        const p = args[0] ? await this.products.getBySku(args[0]) : undefined;
        if (!p || !p.isActive) return this.unknownSku(args[0]);
        return `${p.name} (${p.sku}): ${money(p.priceCents)} per ${p.unit}.`;
      }
      case 'catalog':
      case 'menu': {
        const list = (await this.products.list({ activeOnly: true, limit: 200 })).filter((p) => p.totalQuantity > 0).slice(0, 10);
        if (!list.length) return 'Our catalog is being restocked. Please check back soon!';
        return [`${s.businessName} catalog:`, ...list.map((p) => `• ${p.sku} — ${p.name} — ${money(p.priceCents)}`),
          '', 'Reply "order <SKU> <qty>" to order.'].join('\n');
      }
      case 'order': {
        const qty = Number(args[1]);
        if (!args[0] || !Number.isInteger(qty) || qty < 1 || qty > 1000) return 'To order, send: order <SKU> <qty>  (e.g. "order TEE 2")';
        const p = await this.products.getBySku(args[0]);
        if (!p || !p.isActive) return this.unknownSku(args[0]);
        if (p.totalQuantity < qty) return `Sorry, we only have ${p.totalQuantity} ${p.unit} of ${p.name} right now.`;
        const customer = await this.customers.findOrCreateByChannel(msg.channel, msg.from, msg.senderName);
        try {
          const order = await this.orders.create({ customerId: customer.id, channel: msg.channel, items: [{ productId: p.id, quantity: qty }] });
          return `✅ Order #${order.number} received: ${qty} × ${p.name} = ${money(order.totalCents)}. We'll confirm shortly. Reply "status ${order.number}" any time.`;
        } catch (err) {
          if (err instanceof AppError) return `Sorry, we couldn't place that order: ${err.message}`;
          throw err;
        }
      }
      case 'status': {
        const n = Number(args[0]?.replace('#', ''));
        const order = Number.isInteger(n) && n > 0 ? await this.orders.getByNumber(n) : undefined;
        const customer = await this.customers.findOrCreateByChannel(msg.channel, msg.from, msg.senderName);
        if (!order || order.customerId !== customer.id) return `Sorry, we couldn't find order ${args[0] ?? ''} for you.`;
        return describeOrder(order, money);
      }
      default:
        return [
          `👋 Welcome to ${s.businessName}! You can send:`,
          '• catalog — see what is in stock',
          '• stock <SKU> — check availability',
          '• price <SKU> — check the price',
          '• order <SKU> <qty> — place an order',
          '• status <order#> — track your order',
        ].join('\n');
    }
  }

  private unknownSku(sku: string | undefined): string {
    return `Sorry, we couldn't find a product with SKU "${(sku ?? '').slice(0, 40)}". Send "catalog" to see our products.`;
  }
}

export function describeOrder(order: Order, money: (c: number) => string): string {
  const lines = order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ');
  return `Order #${order.number} is ${order.status}: ${lines} — total ${money(order.totalCents)}.`;
}
