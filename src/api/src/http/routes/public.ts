import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { InsufficientStockError, NotFoundError } from '../../domain/errors.js';
import { ALLOWED_IMAGE_TYPES } from '../../storage/blob.js';
import { requireRole } from '../middleware/auth.js';
import { parse } from '../validate.js';

const orderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'invalid phone'),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(1000) })).min(1).max(50),
});

/** Anonymous storefront API used by the public website. */
export function publicRoutes(c: Container): Router {
  const r = Router();
  const orderLimiter = rateLimit({ windowMs: 15 * 60_000, limit: c.env.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: true, legacyHeaders: false });

  r.get('/catalog', async (_req, res) => {
    const s = await c.settings.get();
    const products = await c.repos.products.list({ activeOnly: true, limit: 1000 });
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      settings: { businessName: s.businessName, currency: s.currency, whatsappNumber: s.whatsappNumber },
      products: products.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, description: p.description, priceCents: p.priceCents, unit: p.unit,
        imageUrl: p.imageUrl, attributes: p.attributes, categoryId: p.categoryId,
        inStock: p.totalQuantity > 0, available: p.totalQuantity,
      })),
    });
  });

  r.post('/orders', orderLimiter, async (req, res) => {
    const o = parse(orderSchema, req.body);
    for (const item of o.items) {
      const p = await c.repos.products.get(item.productId);
      if (!p || !p.isActive) throw new NotFoundError('Product');
      if (p.totalQuantity < item.quantity) throw new InsufficientStockError({ sku: p.sku, available: p.totalQuantity, requested: item.quantity });
    }
    const digits = o.phone.replace(/[^0-9]/g, '');
    const customer = await c.customers.findOrCreateByChannel('web', digits, o.name);
    const order = await c.orders.create({ customerId: customer.id, channel: 'web', items: o.items, notes: o.notes });
    res.status(201).json({ number: order.number, status: order.status, totalCents: order.totalCents });
  });

  return r;
}

const sasSchema = z.object({ filename: z.string().trim().min(1).max(200), contentType: z.enum(ALLOWED_IMAGE_TYPES) });

export function uploadRoutes(c: Container): Router {
  const r = Router();
  r.get('/status', (_req, res) => { res.json({ configured: c.images.isConfigured() }); });
  r.post('/image-sas', requireRole('staff'), async (req, res) => {
    const { contentType } = parse(sasSchema, req.body);
    res.json(await c.images.createUploadSas(contentType));
  });
  return r;
}
