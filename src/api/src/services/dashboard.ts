import type { Queryable } from '../db/pool.js';
import type { DashboardStats } from '../domain/types.js';
import { LOW_STOCK_SQL } from '../repositories/products.js';

export async function dashboardStats(db: Queryable): Promise<DashboardStats> {
  const { rows } = await db.query<DashboardStats>(`
    WITH s AS (SELECT product_id, SUM(quantity) AS total FROM stock_levels GROUP BY product_id)
    SELECT
      (SELECT count(*) FROM products WHERE is_active)::int AS "productCount",
      COALESCE((SELECT SUM(quantity) FROM stock_levels), 0)::bigint AS "totalUnits",
      COALESCE((SELECT SUM(sl.quantity::bigint * p.price_cents) FROM stock_levels sl JOIN products p ON p.id = sl.product_id), 0)::bigint AS "stockValueCents",
      (SELECT count(*) FROM products p LEFT JOIN s ON s.product_id = p.id WHERE p.is_active AND ${LOW_STOCK_SQL})::int AS "lowStockCount",
      (SELECT count(*) FROM orders WHERE status = 'PENDING')::int AS "pendingOrders",
      (SELECT count(*) FROM orders WHERE created_at >= date_trunc('day', now()))::int AS "ordersToday"`);
  return rows[0]!;
}
