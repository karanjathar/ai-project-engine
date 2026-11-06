import { postJson, type ChannelAdapter } from './types.js';

export interface MetaPageConfig { token?: string; graphVersion: string }

/** Facebook Messenger and Instagram Direct both use the Page Send API. */
export class MetaPageAdapter implements ChannelAdapter {
  constructor(
    readonly name: 'messenger' | 'instagram',
    private readonly cfg: MetaPageConfig,
    private readonly fetchFn: typeof fetch,
  ) {}

  isConfigured(): boolean { return Boolean(this.cfg.token); }

  async send(to: string, text: string): Promise<void> {
    await postJson(this.name, this.fetchFn, `https://graph.facebook.com/${this.cfg.graphVersion}/me/messages`, {
      recipient: { id: to },
      messaging_type: 'RESPONSE',
      message: { text: text.slice(0, 2000) },
    }, { authorization: `Bearer ${this.cfg.token}` });
  }
}
