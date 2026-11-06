import { postJson, type ChannelAdapter } from './types.js';

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram' as const;
  constructor(private readonly cfg: { token?: string }, private readonly fetchFn: typeof fetch) {}

  isConfigured(): boolean { return Boolean(this.cfg.token); }

  async send(to: string, text: string): Promise<void> {
    await postJson(this.name, this.fetchFn, `https://api.telegram.org/bot${this.cfg.token}/sendMessage`, {
      chat_id: to,
      text: text.slice(0, 4096),
    });
  }
}
