import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Dashboard } from './Dashboard';
import { mockApi } from '../test/setup';

describe('Dashboard', () => {
  it('renders KPIs, low-stock products and pending orders', async () => {
    mockApi({
      '/dashboard': { productCount: 12, totalUnits: 340, stockValueCents: 1234500, lowStockCount: 2, pendingOrders: 3, ordersToday: 5 },
      '/products?lowStock=true': [{ id: 'p1', sku: 'TEE', name: 'T-Shirt', totalQuantity: 2, reorderLevel: 5, unit: 'pcs' }],
      '/orders?status=PENDING': [{ id: 'o1', number: 17, customerName: 'Asha', channel: 'whatsapp', totalCents: 3000, status: 'PENDING', items: [], createdAt: '2026-11-06T10:00:00Z' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('340')).toBeInTheDocument();
    expect(screen.getByText('$12,345.00')).toBeInTheDocument();
    expect(screen.getByText('Low stock').nextSibling).toHaveTextContent('2');
    expect(await screen.findByText('T-Shirt')).toBeInTheDocument();
    expect(await screen.findByText('#17')).toBeInTheDocument();
    expect(screen.getByText('whatsapp')).toBeInTheDocument();
  });
});
