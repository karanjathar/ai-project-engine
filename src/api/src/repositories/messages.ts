import type { Queryable } from '../db/pool.js';
import type { ChannelMessage, ChannelName, InboundMessage } from '../domain/types.js';

const COLS = `id, channel, direction, external_user AS "externalUser", text, status, created_at AS "createdAt"`;

export class MessagesRepo {
  constructor(private readonly db: Queryable) {}

  /** Returns false when this external message id was already processed (webhook retry). */
  async logInbound(m: InboundMessage): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `INSERT INTO channel_messages (channel, direction, external_user, external_id, text, created_at)
       VALUES ($1, 'in', $2, $3, $4, clock_timestamp()) ON CONFLICT (external_id) DO NOTHING`,
      [m.channel, m.from, m.externalId ?? null, m.text.slice(0, 4096)],
    );
    return (rowCount ?? 0) > 0;
  }

  async logOutbound(channel: ChannelName, to: string, text: string, status: 'ok' | 'failed' | 'skipped'): Promise<void> {
    await this.db.query(
      `INSERT INTO channel_messages (channel, direction, external_user, text, status, created_at)
       VALUES ($1, 'out', $2, $3, $4, clock_timestamp())`,
      [channel, to, text.slice(0, 4096), status],
    );
  }

  async list(f: { channel?: ChannelName; limit?: number }): Promise<ChannelMessage[]> {
    const values: unknown[] = [];
    let where = '';
    if (f.channel) {
      values.push(f.channel);
      where = 'WHERE channel = $1';
    }
    values.push(Math.min(f.limit ?? 100, 500));
    const { rows } = await this.db.query<ChannelMessage>(
      `SELECT ${COLS} FROM channel_messages ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return rows;
  }
}
