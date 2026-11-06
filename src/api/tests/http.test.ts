import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { errorHandler } from '../src/http/middleware/errors.js';
import { ConflictError, NotFoundError } from '../src/domain/errors.js';
import { parse } from '../src/http/validate.js';

let t: TestApp;
beforeAll(async () => { t = await buildTestApp(); });
afterAll(async () => { await t.close(); });

describe('http skeleton', () => {
  it('GET /healthz reports db ok', async () => {
    const res = await request(t.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('sets security headers', async () => {
    const res = await request(t.app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(t.app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(t.app).post('/api/auth/login').set('content-type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });
});

describe('error mapping', () => {
  const app = express();
  app.get('/nf', () => { throw new NotFoundError('Product'); });
  app.get('/conflict', () => { throw new ConflictError('dup'); });
  app.get('/zod', () => { parse(z.object({ n: z.number() }), { n: 'x' }); });
  app.get('/pg-unique', () => { throw Object.assign(new Error('dup key'), { code: '23505' }); });
  app.get('/boom', () => { throw new Error('secret internals'); });
  app.use(errorHandler());

  it.each([
    ['/nf', 404, 'NOT_FOUND'],
    ['/conflict', 409, 'CONFLICT'],
    ['/zod', 400, 'VALIDATION_ERROR'],
    ['/pg-unique', 409, 'CONFLICT'],
    ['/boom', 500, 'INTERNAL'],
  ])('%s → %i %s', async (path, status, code) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });
});
