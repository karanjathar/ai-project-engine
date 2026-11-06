import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export interface AppDeps {
  env: Env;
  pool: pg.Pool;
  logger?: Logger;
}

export function createApp(deps: AppDeps): Express {
  const { env, pool, logger } = deps;
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

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 600, standardHeaders: true, legacyHeaders: false }));

  app.use('/api', api);
  app.use('/api', notFoundHandler);
  app.use('/webhooks', notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
