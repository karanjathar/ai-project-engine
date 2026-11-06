import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let staff: string;
beforeAll(async () => { t = await buildTestApp(); staff = await t.token('staff'); });
afterAll(async () => { await t.close(); });
const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe('warehouses', () => {
  it('CRUD with uppercase unique codes', async () => {
    const res = await request(t.app).post('/api/warehouses').set(auth(staff)).send({ code: 'main', name: 'Main Store', address: '1 High St' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), code: 'MAIN', name: 'Main Store', address: '1 High St' });
    expect((await request(t.app).post('/api/warehouses').set(auth(staff)).send({ code: 'MAIN', name: 'Dup' })).status).toBe(409);
    const patched = await request(t.app).patch(`/api/warehouses/${res.body.id}`).set(auth(staff)).send({ name: 'Main Warehouse' });
    expect(patched.body.name).toBe('Main Warehouse');
    const list = await request(t.app).get('/api/warehouses').set(auth(staff));
    expect(list.body).toHaveLength(1);
    expect((await request(t.app).delete(`/api/warehouses/${res.body.id}`).set(auth(staff))).status).toBe(204);
  });
});
