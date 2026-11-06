import type { Queryable } from '../db/pool.js';

/**
 * Minimal typed CRUD repository for flat tables.
 * Column names come only from the static `columns` map, never from user input.
 */
export class SimpleRepo<T extends { id: string }> {
  private readonly select: string;

  constructor(
    private readonly db: Queryable,
    private readonly table: string,
    private readonly columns: Record<Exclude<keyof T, 'id'>, string>,
    private readonly orderBy: string,
    private readonly searchColumns: string[] = [],
  ) {
    const mapped = Object.entries(columns).map(([camel, snake]) => `${snake as string} AS "${camel}"`);
    this.select = ['id', ...mapped].join(', ');
  }

  async list(search?: string): Promise<T[]> {
    if (search && this.searchColumns.length) {
      const where = this.searchColumns.map((c) => `${c} ILIKE $1`).join(' OR ');
      const { rows } = await this.db.query<T>(
        `SELECT ${this.select} FROM ${this.table} WHERE ${where} ORDER BY ${this.orderBy}`, [`%${escapeLike(search)}%`],
      );
      return rows;
    }
    const { rows } = await this.db.query<T>(`SELECT ${this.select} FROM ${this.table} ORDER BY ${this.orderBy}`);
    return rows;
  }

  async get(id: string): Promise<T | undefined> {
    const { rows } = await this.db.query<T>(`SELECT ${this.select} FROM ${this.table} WHERE id = $1`, [id]);
    return rows[0];
  }

  async create(data: Partial<Omit<T, 'id'>>): Promise<T> {
    const { cols, values } = this.pick(data);
    const placeholders = values.map((_, i) => `$${i + 1}`);
    const { rows } = await this.db.query<T>(
      `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${this.select}`,
      values,
    );
    return rows[0]!;
  }

  async update(id: string, patch: Partial<Omit<T, 'id'>>): Promise<T | undefined> {
    const { cols, values } = this.pick(patch);
    if (!cols.length) return this.get(id);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const { rows } = await this.db.query<T>(
      `UPDATE ${this.table} SET ${sets} WHERE id = $1 RETURNING ${this.select}`, [id, ...values],
    );
    return rows[0];
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }

  private pick(data: Partial<Omit<T, 'id'>>): { cols: string[]; values: unknown[] } {
    const cols: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(this.columns) as [string, string][]) {
      const v = (data as Record<string, unknown>)[key];
      if (v !== undefined) { cols.push(col); values.push(v); }
    }
    return { cols, values };
  }
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
