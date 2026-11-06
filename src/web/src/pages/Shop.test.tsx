import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Shop } from './Shop';
import { mockApi } from '../test/setup';

const catalog = {
  settings: { businessName: 'Corner Shop', currency: 'USD', whatsappNumber: '+1 555 000 1234' },
  products: [
    { id: 'p1', sku: 'TEE', name: 'T-Shirt', description: 'Cotton tee', priceCents: 1500, unit: 'pcs', imageUrl: null, attributes: { color: 'red' }, categoryId: null, inStock: true, available: 3 },
    { id: 'p2', sku: 'MUG', name: 'Mug', description: '', priceCents: 800, unit: 'pcs', imageUrl: null, attributes: {}, categoryId: null, inStock: false, available: 0 },
  ],
};

describe('Shop', () => {
  it('shows products, builds a cart capped at availability and a WhatsApp order link', async () => {
    mockApi({ '/public/catalog': catalog });
    render(<Shop />);
    expect(await screen.findByRole('heading', { name: 'Corner Shop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Mug to cart' })).toBeDisabled();
    const add = screen.getByRole('button', { name: 'Add T-Shirt to cart' });
    for (let i = 0; i < 5; i++) fireEvent.click(add);
    const cart = screen.getByRole('region', { name: 'Cart' });
    expect(within(cart).getByText('3 × T-Shirt')).toBeInTheDocument();
    expect(within(cart).getByText('Total').parentElement).toHaveTextContent('$45.00');
    const wa = within(cart).getByRole('link', { name: /order on whatsapp/i });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/15550001234\?text=/);
    expect(decodeURIComponent(wa.getAttribute('href')!.split('text=')[1]!)).toContain('order TEE 3');
  });

  it('checks out and shows the order number', async () => {
    const calls = mockApi({ '/public/catalog': catalog, 'POST /public/orders': { number: 101, status: 'PENDING', totalCents: 1500 } });
    render(<Shop />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add T-Shirt to cart' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Mia' } });
    fireEvent.change(screen.getByLabelText('Phone (WhatsApp)'), { target: { value: '+15550007777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/Order #101 received/)).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Mia', phone: '+15550007777', items: [{ productId: 'p1', quantity: 1 }],
    }));
  });

  it('filters by search text', async () => {
    mockApi({ '/public/catalog': catalog });
    render(<Shop />);
    await screen.findByText('T-Shirt');
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'mug' } });
    expect(screen.queryByText('T-Shirt')).not.toBeInTheDocument();
    expect(screen.getByText('Mug')).toBeInTheDocument();
  });
});
