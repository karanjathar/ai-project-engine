import pg from 'pg';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/inventory_test';

/** Fresh, fully migrated database for each test file. */
export async function freshDb(): Promise<pg.Pool> {
  const pool = createPool({ connectionString: TEST_DATABASE_URL, ssl: false });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  return pool;
}
