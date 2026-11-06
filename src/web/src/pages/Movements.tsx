import { useState } from 'react';
import { useApi } from '../hooks';
import { dateTime } from '../format';
import { Badge, Card, Empty, ErrorBanner, Page } from '../components/ui';
import type { Product, StockMovement } from '../api/types';

const TONE = { IN: 'good', TRANSFER_IN: 'good', OUT: 'bad', TRANSFER_OUT: 'bad', ADJUST: 'info' } as const;

export function Movements() {
  const [productId, setProductId] = useState('');
  const products = useApi<Product[]>('/products');
  const movements = useApi<StockMovement[]>(`/stock/movements?limit=300${productId ? `&productId=${productId}` : ''}`);

  return (
    <Page title="Stock movements">
      <ErrorBanner error={movements.error} />
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <select aria-label="Filter by product" value={productId} onChange={(e) => setProductId(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">All products</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </select>
          <span className="muted small">Immutable ledger — every stock change with who, why and the resulting balance.</span>
        </div>
        {movements.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Type</th><th>SKU</th><th>Warehouse</th><th className="num">Change</th><th className="num">Balance</th><th>Reason</th><th>Reference</th></tr></thead>
              <tbody>
                {movements.data.map((m) => (
                  <tr key={m.id}>
                    <td className="small">{dateTime(m.createdAt)}</td>
                    <td><Badge tone={TONE[m.type]}>{m.type.replace('_', ' ')}</Badge></td>
                    <td>{m.sku}</td><td>{m.warehouseCode}</td>
                    <td className="num">{m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}</td>
                    <td className="num">{m.balanceAfter}</td>
                    <td>{m.reason}</td><td className="small muted">{m.reference ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{movements.loading ? 'Loading…' : 'No movements yet.'}</Empty>}
      </Card>
    </Page>
  );
}
