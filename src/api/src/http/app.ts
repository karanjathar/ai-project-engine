import express, { Router, type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Container } from '../container.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requireAuth } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { stockRoutes } from './routes/stock.js';
import { settingsRoutes } from './routes/settings.js';
import { categoryRoutes, customerRoutes, productRoutes, supplierRoutes, warehouseRoutes } from './routes/catalog.js';

export function createApp(c: Container): Express {
  const { env, pool, logger } = c;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Azure Container Apps ingress
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https://*.blob.core.windows.net'],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: false }));
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 600, standardHeaders: true, legacyHeaders: false }));
  api.use('/auth', authRoutes(c));

  // Each group below requires a valid token.
  const secure = requireAuth(c.auth);
  api.use('/users', secure, userRoutes(c));
  api.use('/categories', secure, categoryRoutes(c));
  api.use('/products', secure, productRoutes(c));
  api.use('/warehouses', secure, warehouseRoutes(c));
  api.use('/stock', secure, stockRoutes(c));
  api.use('/suppliers', secure, supplierRoutes(c));
  api.use('/customers', secure, customerRoutes(c));
  api.use('/settings', secure, settingsRoutes(c));

  app.use('/api', api);
  app.use('/api', notFoundHandler);
  app.use('/webhooks', notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
