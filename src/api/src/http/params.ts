import type { Request } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../domain/errors.js';

const uuid = z.string().uuid();

/** Reads a UUID route param; malformed ids are reported as 404 (the resource cannot exist). */
export function idParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  const result = uuid.safeParse(value);
  if (!result.success) throw new NotFoundError();
  return result.data;
}
