import { Router } from 'express';
import type { Container } from '../../container.js';
import { settingsPatchSchema } from '../../services/settings.js';
import { requireRole } from '../middleware/auth.js';
import { parse } from '../validate.js';

export function settingsRoutes(c: Container): Router {
  const r = Router();
  r.get('/', async (_req, res) => { res.json(await c.settings.get()); });
  r.put('/', requireRole('admin'), async (req, res) => {
    res.json(await c.settings.update(parse(settingsPatchSchema, req.body)));
  });
  return r;
}
