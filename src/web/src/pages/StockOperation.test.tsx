import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StockOperation } from './StockOperation';
import { mockApi } from '../test/setup';

const products = [{ id: 'p1', sku: 'TEE', name: 'T-Shirt' }];
const warehouses = [{ id: 'w1', code: 'MAIN', name: 'Main', address: '' }, { id: 'w2', code: 'SHOP', name: 'Shop', address: '' }];

describe('StockOperation', () => {
  it('receives stock', async () => {
    const calls = mockApi({ 'POST /stock/receive': { quantity: 5 } });
    const onDone = vi.fn();
    render(<StockOperation products={products} warehouses={warehouses} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Reason / reference'), { target: { value: 'PO-77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ path: '/stock/receive', body: { productId: 'p1', warehouseId: 'w1', quantity: 5, reason: 'PO-77' } });
  });

  it('transfers between two warehouses', async () => {
    const calls = mockApi({ 'POST /stock/transfer': { from: {}, to: {} } });
    render(<StockOperation products={products} warehouses={warehouses} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Transfer' }));
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('From warehouse'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByLabelText('To warehouse'), { target: { value: 'w2' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer stock' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ productId: 'p1', fromWarehouseId: 'w1', toWarehouseId: 'w2', quantity: 3, reason: '' });
  });

  it('shows insufficient-stock errors from the API', async () => {
    mockApi({ 'POST /stock/issue': new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock for TEE: 1 available, 9 requested' } }), { status: 409 }) });
    render(<StockOperation products={products} warehouses={warehouses} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Issue' }));
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 available');
  });
});
