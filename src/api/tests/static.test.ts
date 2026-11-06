import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { createApp } from '../src/http/app.js';

let t: TestApp;
let app: Express;
beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'web-'));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>StockSync</title>');
  await writeFile(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  t = await buildTestApp();
  app = createApp(t.c, { staticDir: dir });
});
afterAll(async () => { await t.close(); });

describe('static SPA hosting', () => {
  it('serves index.html for client-side routes with no-cache', async () => {
    for (const p of ['/', '/products', '/shop/cart']) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>StockSync</title>');
      expect(res.headers['cache-control']).toContain('no-cache');
    }
  });

  it('serves hashed assets with long-lived caching', async () => {
    const res = await request(app).get('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('keeps API and webhook 404s as JSON', async () => {
    const res = await request(app).get('/api/missing');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/webhooks/missing')).status).toBe(404);
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
  });
});
