import { postJson, type ChannelAdapter } from './types.js';

export interface WhatsAppConfig { token?: string; phoneNumberId?: string; graphVersion: string }

/** WhatsApp Business Cloud API (Meta). */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly name = 'whatsapp' as const;
  constructor(private readonly cfg: WhatsAppConfig, private readonly fetchFn: typeof fetch) {}

  isConfigured(): boolean { return Boolean(this.cfg.token && this.cfg.phoneNumberId); }

  async send(to: string, text: string): Promise<void> {
    await postJson(this.name, this.fetchFn, `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/[^0-9]/g, ''),
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4096) },
    }, { authorization: `Bearer ${this.cfg.token}` });
  }
}
