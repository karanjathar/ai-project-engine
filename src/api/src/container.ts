import type pg from 'pg';
import pino, { type Logger } from 'pino';
import type { Env } from './config/env.js';
import { UsersRepo } from './repositories/users.js';
import { AuthService } from './services/auth.js';

export interface ContainerOverrides {
  logger?: Logger;
  fetch?: typeof fetch;
}

export function createContainer(opts: { env: Env; pool: pg.Pool } & ContainerOverrides) {
  const { env, pool } = opts;
  const logger = opts.logger ?? pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
  const repos = {
    users: new UsersRepo(pool),
  };
  const auth = new AuthService(repos.users, env.JWT_SECRET, env.JWT_EXPIRES_IN, env.NODE_ENV === 'test' ? 4 : 12);
  return { env, pool, logger, repos, auth };
}

export type Container = ReturnType<typeof createContainer>;
