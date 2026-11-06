import type { AuthUser } from '../domain/types.js';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      user?: AuthUser;
    }
  }
}

export {};
