import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { NotFoundError } from '../../domain/errors.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { parse } from '../validate.js';

const loginSchema = z.object({ email: z.string().trim().min(1).max(320), password: z.string().min(1).max(200) });

export function authRoutes(c: Container): Router {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: c.env.NODE_ENV === 'test' ? 1000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
  });
  r.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    res.json(await c.auth.login(email, password));
  });
  r.get('/me', requireAuth(c.auth), async (req, res) => {
    const user = await c.repos.users.findById(currentUser(req).id);
    if (!user) throw new NotFoundError('User');
    res.json(user);
  });
  return r;
}
