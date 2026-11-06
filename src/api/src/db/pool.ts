import pg from 'pg';

// Return timestamps as ISO strings and bigint/numeric aggregates as numbers (values stay well below 2^53).
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

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
