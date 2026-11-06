import type pg from 'pg';
import pino, { type Logger } from 'pino';
import type { Env } from './config/env.js';
import { UsersRepo } from './repositories/users.js';
import { SimpleRepo } from './repositories/simple.js';
import { ProductsRepo } from './repositories/products.js';
import { CustomersRepo } from './repositories/customers.js';
import type { Category, Supplier, Warehouse } from './domain/types.js';
import { AuthService } from './services/auth.js';
import { StockService } from './services/stock.js';
import { SettingsService } from './services/settings.js';
import { EventBus } from './realtime/bus.js';
import { OrdersService } from './services/orders.js';
import { AlertService } from './services/alerts.js';
import { noopMessenger, type Messenger } from './services/messenger.js';

export interface ContainerOverrides {
  logger?: Logger;
  fetch?: typeof fetch;
  /** Replaces the channel hub for outbound messages (tests). */
  messenger?: Messenger;
}

export function createContainer(opts: { env: Env; pool: pg.Pool } & ContainerOverrides) {
  const { env, pool } = opts;
  const logger = opts.logger ?? pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
  const repos = {
    users: new UsersRepo(pool),
    categories: new SimpleRepo<Category>(pool, 'categories', { name: 'name' }, 'name', ['name']),
    products: new ProductsRepo(pool),
    suppliers: new SimpleRepo<Supplier>(pool, 'suppliers', { name: 'name', email: 'email', phone: 'phone', notes: 'notes' }, 'name', ['name', 'email', 'phone']),
    warehouses: new SimpleRepo<Warehouse>(pool, 'warehouses', { code: 'code', name: 'name', address: 'address' }, 'code', ['code', 'name']),
  };
  const auth = new AuthService(repos.users, env.JWT_SECRET, env.JWT_EXPIRES_IN, env.NODE_ENV === 'test' ? 4 : 12);
  const stock = new StockService(pool, (err) => logger.error({ err }, 'stock observer failed'));
  const events = new EventBus();
  stock.onChanged(async (changes) => {
    for (const ch of changes) {
      const p = await repos.products.get(ch.productId);
      if (!p) continue;
      events.publish({ type: 'stock.changed', productId: p.id, sku: p.sku, warehouseId: ch.warehouseId, quantity: ch.quantity, totalQuantity: p.totalQuantity });
    }
  });
  const customers = new CustomersRepo(pool);
  const settings = new SettingsService(pool);
  const orders = new OrdersService(pool, stock, settings, events, (err) => logger.error({ err }, 'order observer failed'));
  let messenger: Messenger = opts.messenger ?? noopMessenger;
  const alerts = new AlertService(repos.products, settings, events, () => messenger, logger);
  stock.onChanged((changes) => alerts.onStockChanged(changes));
  const setMessenger = (m: Messenger) => { messenger = opts.messenger ?? m; };
  return { env, pool, logger, repos, auth, stock, customers, settings, events, orders, alerts, setMessenger, messenger: () => messenger };
}

export type Container = ReturnType<typeof createContainer>;
