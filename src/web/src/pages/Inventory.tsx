import { useSearchParams } from 'react-router';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { Card, Empty, ErrorBanner, Page } from '../components/ui';
import { StockOperation } from './StockOperation';
import type { Product, StockLevel, Warehouse } from '../api/types';

export function Inventory() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const productId = params.get('productId') ?? '';
  const warehouseId = params.get('warehouseId') ?? '';
  const qs = new URLSearchParams({ ...(productId && { productId }), ...(warehouseId && { warehouseId }) }).toString();
  const levels = useApi<StockLevel[]>(`/stock${qs ? `?${qs}` : ''}`);
  const products = useApi<Product[]>('/products');
  const warehouses = useApi<Warehouse[]>('/warehouses');

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Page title="Inventory">
      <ErrorBanner error={levels.error} />
      {can('staff') && products.data && warehouses.data && (
        warehouses.data.length ? (
          <StockOperation products={products.data} warehouses={warehouses.data} initialProductId={productId} onDone={levels.reload} />
        ) : <div className="banner error">Create a warehouse first (Warehouses page) to start tracking stock.</div>
      )}
      <Card title="Stock levels">
        <div className="row" style={{ marginBottom: 12 }}>
          <select aria-label="Filter by product" value={productId} onChange={(e) => setFilter('productId', e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">All products</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </select>
          <select aria-label="Filter by warehouse" value={warehouseId} onChange={(e) => setFilter('warehouseId', e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All warehouses</option>
            {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </select>
        </div>
        {levels.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>Warehouse</th><th className="num">Quantity</th></tr></thead>
              <tbody>
                {levels.data.map((l) => (
                  <tr key={`${l.productId}-${l.warehouseId}`}><td>{l.productName}</td><td>{l.sku}</td><td>{l.warehouseCode}</td><td className="num">{l.quantity}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{levels.loading ? 'Loading…' : 'No stock recorded yet. Use “Receive” above to add stock.'}</Empty>}
      </Card>
    </Page>
  );
}
