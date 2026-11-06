import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { buildTestApp, type TestApp } from './helpers/app.js';
import { createApp } from '../src/http/app.js';
import { createContainer } from '../src/container.js';

let t: TestApp;
beforeAll(async () => { t = await buildTestApp(); });
afterAll(async () => { await t.close(); });
const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe('request logging', () => {
  it('logs method, route path, status and duration but never tokens or query strings', async () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
    const logger = pino({ level: 'info' }, sink);
    const c = createContainer({ env: t.env, pool: t.pool, logger });
    const app = createApp(c);
    const token = await t.token('viewer');
    await request(app).get('/api/products?search=secret-query').set(auth(token));
    const entry = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.msg === 'request');
    expect(entry).toMatchObject({ method: 'GET', path: '/api/products', status: 200 });
    expect(typeof entry!.ms).toBe('number');
    const all = lines.join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain('secret-query');
  });
});

describe('customer chat data is staff-only', () => {
  it('viewers cannot read the inbox', async () => {
    expect((await request(t.app).get('/api/messages').set(auth(await t.token('viewer')))).status).toBe(403);
    expect((await request(t.app).get('/api/messages').set(auth(await t.token('staff')))).status).toBe(200);
  });
});

describe('self-service password change', () => {
  it('requires the current password and enforces length', async () => {
    await t.c.auth.createUser({ email: 'pw@test.local', password: 'OldPassword1', name: 'Pw', role: 'viewer' });
    const login = await request(t.app).post('/api/auth/login').send({ email: 'pw@test.local', password: 'OldPassword1' });
    const h = auth(login.body.token);
    expect((await request(t.app).post('/api/auth/password').set(h).send({ currentPassword: 'wrong', newPassword: 'NewPassword1' })).status).toBe(401);
    expect((await request(t.app).post('/api/auth/password').set(h).send({ currentPassword: 'OldPassword1', newPassword: 'short' })).status).toBe(400);
    expect((await request(t.app).post('/api/auth/password').set(h).send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword1' })).status).toBe(204);
    expect((await request(t.app).post('/api/auth/login').send({ email: 'pw@test.local', password: 'OldPassword1' })).status).toBe(401);
    expect((await request(t.app).post('/api/auth/login').send({ email: 'pw@test.local', password: 'NewPassword1' })).status).toBe(200);
  });
});
