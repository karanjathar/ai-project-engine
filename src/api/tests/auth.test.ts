import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildTestApp, type TestApp } from './helpers/app.js';

let t: TestApp;
beforeAll(async () => { t = await buildTestApp(); });
afterAll(async () => { await t.close(); });

describe('auth', () => {
  it('logs in the bootstrap admin and returns a token without the password hash', async () => {
    const res = await request(t.app).post('/api/auth/login').send({ email: 'ADMIN@test.local', password: 'AdminPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toMatchObject({ email: 'admin@test.local', role: 'admin' });
    expect(JSON.stringify(res.body)).not.toMatch(/hash/i);
  });

  it('bootstrap is idempotent', async () => {
    await t.c.auth.bootstrapAdmin('other@test.local', 'whatever123');
    const { rows } = await t.pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin'");
    expect(rows[0].n).toBe(1);
  });

  it('rejects wrong password and unknown email with the same 401', async () => {
    const a = await request(t.app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'nope-nope' });
    const b = await request(t.app).post('/api/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('GET /auth/me requires a valid token', async () => {
    expect((await request(t.app).get('/api/auth/me')).status).toBe(401);
    expect((await request(t.app).get('/api/auth/me').set('authorization', 'Bearer garbage')).status).toBe(401);
    const forged = jwt.sign({ sub: 'x', role: 'admin', email: 'x' }, 'wrong-secret'.padEnd(40, 'y'));
    expect((await request(t.app).get('/api/auth/me').set('authorization', `Bearer ${forged}`)).status).toBe(401);
    const tok = await t.token('viewer');
    const ok = await request(t.app).get('/api/auth/me').set('authorization', `Bearer ${tok}`);
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('viewer');
  });

  it('rejects tokens for deleted users', async () => {
    const admin = await t.token('admin');
    await t.c.auth.createUser({ email: 'temp@test.local', password: 'Password123!', name: 'Temp', role: 'staff' });
    const login = await request(t.app).post('/api/auth/login').send({ email: 'temp@test.local', password: 'Password123!' });
    await request(t.app).delete(`/api/users/${login.body.user.id}`).set('authorization', `Bearer ${admin}`).expect(204);
    const res = await request(t.app).get('/api/auth/me').set('authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(401);
  });
});

describe('users admin', () => {
  it('only admins can list or create users', async () => {
    const staff = await t.token('staff');
    expect((await request(t.app).get('/api/users').set('authorization', `Bearer ${staff}`)).status).toBe(403);
    const admin = await t.token('admin');
    const created = await request(t.app).post('/api/users').set('authorization', `Bearer ${admin}`)
      .send({ email: 'new@test.local', password: 'Password123!', name: 'New', role: 'staff' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('passwordHash');
    const list = await request(t.app).get('/api/users').set('authorization', `Bearer ${admin}`);
    expect(list.body.map((u: { email: string }) => u.email)).toContain('new@test.local');
  });

  it('validates input and rejects duplicate emails', async () => {
    const admin = await t.token('admin');
    const bad = await request(t.app).post('/api/users').set('authorization', `Bearer ${admin}`)
      .send({ email: 'not-an-email', password: 'short', name: '', role: 'god' });
    expect(bad.status).toBe(400);
    const dup = await request(t.app).post('/api/users').set('authorization', `Bearer ${admin}`)
      .send({ email: 'new@test.local', password: 'Password123!', name: 'Dup', role: 'staff' });
    expect(dup.status).toBe(409);
  });

  it('an admin can change a role but cannot delete themselves', async () => {
    const admin = await t.token('admin');
    const me = await request(t.app).get('/api/auth/me').set('authorization', `Bearer ${admin}`);
    expect((await request(t.app).delete(`/api/users/${me.body.id}`).set('authorization', `Bearer ${admin}`)).status).toBe(409);
    const list = await request(t.app).get('/api/users').set('authorization', `Bearer ${admin}`);
    const target = list.body.find((u: { email: string }) => u.email === 'new@test.local');
    const patched = await request(t.app).patch(`/api/users/${target.id}`).set('authorization', `Bearer ${admin}`).send({ role: 'viewer' });
    expect(patched.status).toBe(200);
    expect(patched.body.role).toBe('viewer');
  });
});
