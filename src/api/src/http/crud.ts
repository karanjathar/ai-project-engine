import { Router } from 'express';
import type { z } from 'zod';
import { NotFoundError } from '../domain/errors.js';
import type { Role } from '../domain/types.js';
import type { SimpleRepo } from '../repositories/simple.js';
import { requireRole } from './middleware/auth.js';
import { idParam } from './params.js';
import { parse } from './validate.js';

export interface CrudOptions<T extends { id: string }> {
  entity: string;
  repo: SimpleRepo<T>;
  create: z.ZodType<Partial<Omit<T, 'id'>>>;
  patch: z.ZodType<Partial<Omit<T, 'id'>>>;
  writeRole?: Role;
}

export function crudRoutes<T extends { id: string }>(o: CrudOptions<T>): Router {
  const r = Router();
  const write = requireRole(o.writeRole ?? 'staff');
  r.get('/', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(await o.repo.list(search));
  });
  r.get('/:id', async (req, res) => {
    const item = await o.repo.get(idParam(req));
    if (!item) throw new NotFoundError(o.entity);
    res.json(item);
  });
  r.post('/', write, async (req, res) => {
    res.status(201).json(await o.repo.create(parse(o.create, req.body)));
  });
  r.patch('/:id', write, async (req, res) => {
    const item = await o.repo.update(idParam(req), parse(o.patch, req.body));
    if (!item) throw new NotFoundError(o.entity);
    res.json(item);
  });
  r.delete('/:id', write, async (req, res) => {
    if (!(await o.repo.delete(idParam(req)))) throw new NotFoundError(o.entity);
    res.status(204).end();
  });
  return r;
}
