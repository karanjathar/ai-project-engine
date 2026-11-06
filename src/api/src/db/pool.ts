import pg from 'pg';

export interface PoolOptions {
  connectionString: string;
  ssl: boolean;
}

export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool({ connectionString, ssl }: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    // Azure Database for PostgreSQL requires TLS; certificates are validated.
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
  });
}
