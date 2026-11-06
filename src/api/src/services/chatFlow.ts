import type { BotReply, ReplyListRow } from '../channels/reply.js';
import { AppError } from '../domain/errors.js';
import type { InboundMessage, Product } from '../domain/types.js';
import type { ChatCartsRepo } from '../repositories/chatCarts.js';
import type { CustomersRepo } from '../repositories/customers.js';
import type { ProductsRepo } from '../repositories/products.js';
import type { SimpleRepo } from '../repositories/simple.js';
import type { Category } from '../domain/types.js';
import { formatMoney } from './money.js';
import type { SettingsService } from './settings.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PAGE = 9;
const QTY_CHOICES = [1, 2, 3, 4, 5, 10];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Tap-to-order conversation (docs/3_SCHEMAS.md §3.12). Returns undefined for actions it doesn't own. */
export class ChatFlow {
  constructor(
    private readonly products: ProductsRepo,
    private readonly categories: SimpleRepo<Category>,
    private readonly customers: CustomersRepo,
    private readonly carts: ChatCartsRepo,
    private readonly settings: SettingsService,
  ) {}

  async handle(msg: InboundMessage): Promise<BotReply | undefined> {
    const action = msg.action ?? '';
    const s = await this.settings.get();
    const money = (c: number) => formatMoney(c, s.currency);
    try {
      if (action === 'menu') return this.menu(s.businessName);
      if (action === 'catalog') return await this.catalog();
      let m = new RegExp(`^cat:(${UUID}|all):(-?\\d{1,4})$`).exec(action);
      if (m) return await this.category(m[1]!, Math.max(0, Number(m[2])), money);
      m = new RegExp(`^prod:(${UUID})$`).exec(action);
      if (m) return await this.product(m[1]!, money);
      m = new RegExp(`^qty:(${UUID}):(\\d{1,3})$`).exec(action);
      if (m) return await this.addToCart(msg, m[1]!, Number(m[2]), money);
      if (/^(prod|qty|cat):/.test(action)) return this.sorry('That option is no longer valid.');
      return undefined;
    } catch (err) {
      if (err instanceof AppError) return this.sorry(err.message);
      throw err;
    }
  }

  menu(businessName: string): BotReply {
    return {
      text: `👋 Welcome to ${businessName}! Tap a button to shop. (You can also type "help" for text commands.)`,
      buttons: [{ id: 'catalog', title: '🛍 Browse' }, { id: 'cart', title: '🛒 My cart' }, { id: 'orders', title: '📦 My orders' }],
    };
  }

  private async orderable(): Promise<Product[]> {
    return (await this.products.list({ activeOnly: true, limit: 1000 })).filter((p) => p.totalQuantity > 0);
  }

  private async catalog(): Promise<BotReply> {
    const products = await this.orderable();
    if (!products.length) return { text: 'Our shelves are being restocked — please check back soon!' };
    const counts = new Map<string, number>();
    for (const p of products) if (p.categoryId) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    const cats = (await this.categories.list()).filter((c) => counts.has(c.id));
    if (cats.length <= 1) {
      const s = await this.settings.get();
      return this.category(cats[0]?.id ?? 'all', 0, (c) => formatMoney(c, s.currency));
    }
    const rows: ReplyListRow[] = cats.slice(0, 9).map((c) => ({ id: `cat:${c.id}:0`, title: c.name, description: plural(counts.get(c.id)!, 'product') }));
    rows.push({ id: 'cat:all:0', title: 'All products', description: plural(products.length, 'product') });
    return { text: 'What are you looking for?', list: { button: 'Categories', sections: [{ title: 'Categories', rows }] } };
  }

  private async category(categoryId: string, offset: number, money: (c: number) => string): Promise<BotReply> {
    if (categoryId !== 'all' && !(await this.categories.get(categoryId))) return this.sorry('That category no longer exists.');
    const all = (await this.orderable()).filter((p) => categoryId === 'all' || p.categoryId === categoryId);
    const page = all.slice(offset, offset + PAGE);
    if (!page.length) return { text: 'Nothing available here right now.', buttons: [{ id: 'catalog', title: '🛍 Browse' }] };
    const rows: ReplyListRow[] = page.map((p) => ({ id: `prod:${p.id}`, title: p.name, description: `${money(p.priceCents)} · ${p.totalQuantity} left` }));
    const rest = all.length - offset - PAGE;
    if (rest > 0) rows.push({ id: `cat:${categoryId}:${offset + PAGE}`, title: 'More…', description: `Show ${rest} more` });
    const name = categoryId === 'all' ? 'All products' : (await this.categories.get(categoryId))!.name;
    return { text: `${name} — pick a product:`, list: { button: 'Products', sections: [{ title: name, rows }] } };
  }

  private async product(productId: string, money: (c: number) => string): Promise<BotReply> {
    const p = await this.products.get(productId);
    if (!p) return this.sorry('That product no longer exists.');
    if (!p.isActive || p.totalQuantity <= 0) return this.sorry(`${p.name} is not available right now.`);
    const attrs = Object.entries(p.attributes).map(([k, v]) => `${k}: ${v}`).join(' · ');
    const text = [
      `*${p.name}*`,
      `${money(p.priceCents)} per ${p.unit} · ${p.totalQuantity} in stock`,
      p.description, attrs,
      'How many would you like?',
    ].filter(Boolean).join('\n');
    const rows = QTY_CHOICES.filter((n) => n <= p.totalQuantity).map((n) => ({ id: `qty:${p.id}:${n}`, title: String(n), description: money(n * p.priceCents) }));
    return { text, list: { button: 'Choose quantity', sections: [{ title: 'Quantity', rows }] } };
  }

  private async addToCart(msg: InboundMessage, productId: string, quantity: number, money: (c: number) => string): Promise<BotReply> {
    const customer = await this.customers.findOrCreateByChannel(msg.channel, msg.from, msg.senderName);
    const p = await this.products.get(productId);
    if (!p) return this.sorry('That product no longer exists.');
    const { added, capped } = await this.carts.add(customer.id, productId, quantity);
    const cart = await this.carts.get(customer.id);
    const items = cart.lines.reduce((n, l) => n + l.quantity, 0);
    const lines = [
      added > 0 ? `✅ Added ${added} × ${p.name} to your cart.` : `Your cart already has all available ${p.name}.`,
      capped ? `(We have only ${p.totalQuantity} available.)` : '',
      `🛒 Cart: ${plural(items, 'item')} · ${money(cart.totalCents)}`,
    ].filter(Boolean);
    return {
      text: lines.join('\n'),
      buttons: [{ id: 'checkout', title: '🧾 Checkout' }, { id: 'catalog', title: '🛍 Keep shopping' }, { id: 'cart:clear', title: '🗑 Clear cart' }],
    };
  }

  private sorry(message: string): BotReply {
    return { text: `Sorry — ${message}`, buttons: [{ id: 'catalog', title: '🛍 Browse' }, { id: 'menu', title: '🏠 Menu' }] };
  }
}
