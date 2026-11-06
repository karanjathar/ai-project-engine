import type pg from 'pg';
import type { Express } from 'express';
import { freshDb } from './db.js';
import { createApp } from '../../src/http/app.js';
import { loadEnv } from '../../src/config/env.js';

export interface TestApp { app: Express; pool: pg.Pool; close(): Promise<void> }

export async function buildTestApp(): Promise<TestApp> {
  const pool = await freshDb();
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://test', JWT_SECRET: 'test-secret-'.padEnd(40, 'x') });
  const app = createApp({ env, pool });
  return { app, pool, close: () => pool.end() };
}
