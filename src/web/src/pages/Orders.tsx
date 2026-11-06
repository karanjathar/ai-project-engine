import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { useAction, useApi } from '../hooks';
import { useSettings } from '../settings';
import { dateTime, money } from '../format';
import { Badge, Card, Empty, ErrorBanner, Field, Page, STATUS_TONE } from '../components/ui';
import type { Customer, Order, OrderStatus, Product, Warehouse } from '../api/types';

const FILTERS: (OrderStatus | 'ALL')[] = ['ALL', 'PENDING', 'CONFIRMED', 'FULFILLED', 'CANCELLED'];

export function Orders() {
  const { can } = useAuth();
  const { settings } = useSettings();
  const [filter, setFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);
  const [warehouseFor, setWarehouseFor] = useState<Record<string, string>>({});
  const orders = useApi<Order[]>(filter === 'ALL' ? '/orders' : `/orders?status=${filter}`);
  const warehouses = useApi<Warehouse[]>('/warehouses');
  const action = useAction();
  const canWrite = can('staff');

  const transition = async (o: Order, verb: 'confirm' | 'fulfill' | 'cancel') => {
    if (verb === 'cancel' && !window.confirm(`Cancel order #${o.number}?${o.status === 'CONFIRMED' ? ' Stock will be returned.' : ''}`)) return;
    const wh = warehouseFor[o.id];
    const body = verb === 'confirm' ? (wh ? { warehouseId: wh } : {}) : {};
    const ok = await action.run(() => api(`/orders/${o.id}/${verb}`, { body }));
    if (ok) orders.reload();
  };

  return (
    <Page title="Orders" actions={canWrite && <button className="primary" onClick={() => setCreating(true)}>+ New order</button>}>
      <ErrorBanner error={orders.error ?? action.error} />
      {creating && <NewOrder onDone={() => { setCreating(false); orders.reload(); }} onCancel={() => setCreating(false)} />}
      <div className="row" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'primary small' : 'small'} onClick={() => setFilter(f)}>{f.toLowerCase()}</button>
        ))}
      </div>
      <Card>
        {orders.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id}>
                    <td><strong>#{o.number}</strong><div className="muted small">{dateTime(o.createdAt)}</div></td>
                    <td>{o.customerName}<div><Badge tone="info">{o.channel}</Badge></div></td>
                    <td>{o.items.map((i) => <div key={i.productId}>{i.quantity} × {i.name}</div>)}{o.notes && <div className="muted small">{o.notes}</div>}</td>
                    <td className="num">{money(o.totalCents, settings.currency)}</td>
                    <td><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                    <td>{canWrite && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {o.status === 'PENDING' && (
                          <>
                            <select aria-label={`Warehouse for #${o.number}`} style={{ width: 'auto' }}
                              value={warehouseFor[o.id] ?? settings.defaultWarehouseId ?? ''}
                              onChange={(e) => setWarehouseFor((m) => ({ ...m, [o.id]: e.target.value }))}>
                              <option value="">Warehouse…</option>
                              {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                            </select>
                            <button className="small primary" disabled={action.busy} onClick={() => void transition(o, 'confirm')}>Confirm</button>
                          </>
                        )}
                        {o.status === 'CONFIRMED' && <button className="small primary" disabled={action.busy} onClick={() => void transition(o, 'fulfill')}>Fulfil</button>}
                        {(o.status === 'PENDING' || o.status === 'CONFIRMED') && <button className="small danger" disabled={action.busy} onClick={() => void transition(o, 'cancel')}>Cancel</button>}
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{orders.loading ? 'Loading…' : 'No orders.'}</Empty>}
      </Card>
    </Page>
  );
}

function NewOrder({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const customers = useApi<Customer[]>('/customers');
  const products = useApi<Product[]>('/products');
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([{ productId: '', quantity: '1' }]);
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();

  const setLine = (i: number, patch: Partial<{ productId: string; quantity: string }>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const items = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    const ok = await run(() => api('/orders', { body: { customerId, items, notes: notes || undefined } }));
    if (ok) onDone();
  };

  return (
    <form className="card grid" onSubmit={submit} aria-label="New order">
      <h2>New order</h2>
      <ErrorBanner error={error} />
      <Field label="Customer">
        <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Select… (add customers on the Customers page)</option>
          {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
        </select>
      </Field>
      {lines.map((l, i) => (
        <div className="form-grid" key={i}>
          <Field label={`Item ${i + 1}`}>
            <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
              <option value="">Select product…</option>
              {products.data?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name} ({p.totalQuantity} in stock)</option>)}
            </select>
          </Field>
          <Field label="Qty"><input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></Field>
        </div>
      ))}
      <div><button type="button" className="small" onClick={() => setLines((ls) => [...ls, { productId: '', quantity: '1' }])}>+ Add item</button></div>
      <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>Create order</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
