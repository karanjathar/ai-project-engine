import { z } from 'zod';
import type { InboundMessage } from '../domain/types.js';

// Schemas are deliberately permissive (unknown keys allowed); only the fields we use are checked.
const waValue = z.object({
  contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(z.object({
    id: z.string(),
    from: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
  })).optional(),
});

const metaBody = z.object({
  object: z.string(),
  entry: z.array(z.object({
    changes: z.array(z.object({ value: z.unknown() })).optional(),
    messaging: z.array(z.unknown()).optional(),
  })),
});

const pageEvent = z.object({
  sender: z.object({ id: z.string() }),
  message: z.object({ mid: z.string(), text: z.string().optional(), is_echo: z.boolean().optional() }),
});

/** Extracts text messages from a Meta webhook (WhatsApp Business, Messenger page, Instagram). */
export function parseMetaWebhook(body: unknown): InboundMessage[] {
  const parsed = metaBody.safeParse(body);
  if (!parsed.success) return [];
  const out: InboundMessage[] = [];
  const { object, entry } = parsed.data;

  if (object === 'whatsapp_business_account') {
    for (const e of entry) {
      for (const change of e.changes ?? []) {
        const v = waValue.safeParse(change.value);
        if (!v.success) continue;
        for (const m of v.data.messages ?? []) {
          if (m.type !== 'text' || !m.text) continue;
          const contact = v.data.contacts?.find((c) => c.wa_id === m.from) ?? v.data.contacts?.[0];
          const name = contact?.profile?.name;
          out.push({ channel: 'whatsapp', from: m.from, text: m.text.body, externalId: m.id, ...(name ? { senderName: name } : {}) });
        }
      }
    }
  } else if (object === 'page' || object === 'instagram') {
    const channel = object === 'page' ? 'messenger' : 'instagram';
    for (const e of entry) {
      for (const raw of e.messaging ?? []) {
        const ev = pageEvent.safeParse(raw);
        if (!ev.success || ev.data.message.is_echo || !ev.data.message.text) continue;
        out.push({ channel, from: ev.data.sender.id, text: ev.data.message.text, externalId: ev.data.message.mid });
      }
    }
  }
  return out;
}

const tgUpdate = z.object({
  message: z.object({
    message_id: z.number(),
    chat: z.object({ id: z.union([z.number(), z.string()]) }),
    from: z.object({ first_name: z.string().optional() }).optional(),
    text: z.string(),
  }),
});

export function parseTelegramUpdate(body: unknown): InboundMessage | undefined {
  const u = tgUpdate.safeParse(body);
  if (!u.success) return undefined;
  const m = u.data.message;
  const chatId = String(m.chat.id);
  const name = m.from?.first_name;
  return { channel: 'telegram', from: chatId, text: m.text, externalId: `tg:${chatId}:${m.message_id}`, ...(name ? { senderName: name } : {}) };
}
