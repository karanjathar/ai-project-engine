import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb } from './helpers/db.js';
import { fakeFetch } from './helpers/fakeFetch.js';
import { WhatsAppAdapter } from '../src/channels/whatsapp.js';
import { MetaPageAdapter } from '../src/channels/metaPage.js';
import { TelegramAdapter } from '../src/channels/telegram.js';
import { ChannelHub } from '../src/channels/hub.js';
import { MessagesRepo } from '../src/repositories/messages.js';

let pool: pg.Pool;
beforeAll(async () => { pool = await freshDb(); });
afterAll(async () => { await pool.end(); });

describe('adapters', () => {
  it('WhatsApp Cloud API request shape', async () => {
    const f = fakeFetch();
    const wa = new WhatsAppAdapter({ token: 'WA_TOKEN', phoneNumberId: '1234', graphVersion: 'v21.0' }, f.fn);
    expect(wa.isConfigured()).toBe(true);
    await wa.send('+15551234567', 'hello');
    expect(f.calls[0]).toMatchObject({
      url: 'https://graph.facebook.com/v21.0/1234/messages', method: 'POST',
      headers: { authorization: 'Bearer WA_TOKEN', 'content-type': 'application/json' },
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15551234567', type: 'text', text: { preview_url: false, body: 'hello' } },
    });
  });

  it('Messenger / Instagram send API request shape and truncation', async () => {
    const f = fakeFetch();
    const ig = new MetaPageAdapter('instagram', { token: 'PAGE', graphVersion: 'v21.0' }, f.fn);
    await ig.send('IGSID', 'x'.repeat(2500));
    expect(f.calls[0]).toMatchObject({
      url: 'https://graph.facebook.com/v21.0/me/messages',
      headers: { authorization: 'Bearer PAGE' },
      body: { recipient: { id: 'IGSID' }, messaging_type: 'RESPONSE' },
    });
    expect((f.calls[0]!.body as { message: { text: string } }).message.text).toHaveLength(2000);
  });

  it('Telegram sendMessage request shape', async () => {
    const f = fakeFetch();
    const tg = new TelegramAdapter({ token: '123:ABC' }, f.fn);
    await tg.send('42', 'hi');
    expect(f.calls[0]).toMatchObject({ url: 'https://api.telegram.org/bot123:ABC/sendMessage', body: { chat_id: '42', text: 'hi' } });
  });

  it('is unconfigured without credentials and errors do not leak tokens', async () => {
    expect(new WhatsAppAdapter({ graphVersion: 'v21.0' }, fetch).isConfigured()).toBe(false);
    const f = fakeFetch(401, { error: { message: 'Invalid OAuth access token' } });
    const tg = new TelegramAdapter({ token: 'SECRET-TOKEN' }, f.fn);
    const err = await tg.send('1', 'x').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain('SECRET-TOKEN');
  });
});

describe('ChannelHub', () => {
  it('sends, logs outbound messages and reports status', async () => {
    const f = fakeFetch();
    const repo = new MessagesRepo(pool);
    const hub = new ChannelHub([
      new TelegramAdapter({ token: 't' }, f.fn),
      new WhatsAppAdapter({ graphVersion: 'v21.0' }, f.fn),
    ], repo);
    await hub.send('telegram', '42', 'hello there');
    await hub.send('whatsapp', '1555', 'not configured');
    expect(f.calls).toHaveLength(1);
    const log = await repo.list({});
    expect(log.map((m) => [m.channel, m.direction, m.status, m.text])).toEqual([
      ['whatsapp', 'out', 'skipped', 'not configured'],
      ['telegram', 'out', 'ok', 'hello there'],
    ]);
    expect(hub.status()).toEqual([{ name: 'telegram', configured: true }, { name: 'whatsapp', configured: false }]);
  });

  it('logs failures and rethrows', async () => {
    const repo = new MessagesRepo(pool);
    const hub = new ChannelHub([new TelegramAdapter({ token: 't' }, fakeFetch(500).fn)], repo);
    await expect(hub.send('telegram', '9', 'boom')).rejects.toThrow(/500/);
    expect((await repo.list({ channel: 'telegram', limit: 1 }))[0]!.status).toBe('failed');
  });

  it('message log de-duplicates inbound messages by external id', async () => {
    const repo = new MessagesRepo(pool);
    expect(await repo.logInbound({ channel: 'whatsapp', from: '1', text: 'hi', externalId: 'wamid.1' })).toBe(true);
    expect(await repo.logInbound({ channel: 'whatsapp', from: '1', text: 'hi', externalId: 'wamid.1' })).toBe(false);
  });
});

describe('WhatsApp interactive replies (T25)', () => {
  const wa = () => {
    const f = fakeFetch();
    return { f, a: new WhatsAppAdapter({ token: 'T', phoneNumberId: '99', graphVersion: 'v21.0' }, f.fn) };
  };
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15551234567' };

  it('sends reply buttons', async () => {
    const { f, a } = wa();
    await a.sendReply('+1 555 123 4567', { text: 'Welcome!', buttons: [{ id: 'catalog', title: '🛍 Browse' }, { id: 'orders', title: '📦 My orders' }] });
    expect(f.calls[0]).toMatchObject({ url: 'https://graph.facebook.com/v21.0/99/messages', headers: { authorization: 'Bearer T' } });
    expect(f.calls[0]!.body).toEqual({
      ...base, type: 'interactive',
      interactive: { type: 'button', body: { text: 'Welcome!' }, action: { buttons: [
        { type: 'reply', reply: { id: 'catalog', title: '🛍 Browse' } },
        { type: 'reply', reply: { id: 'orders', title: '📦 My orders' } },
      ] } },
    });
  });

  it('sends list messages', async () => {
    const { f, a } = wa();
    await a.sendReply('15551234567', { text: 'Pick a product', list: { button: 'Products', sections: [{ title: 'Apparel', rows: [{ id: 'prod:1', title: 'Red Tee', description: '₹499 · 40 left' }, { id: 'prod:2', title: 'Cap' }] }] } });
    expect(f.calls[0]!.body).toEqual({
      ...base, type: 'interactive',
      interactive: { type: 'list', body: { text: 'Pick a product' }, action: { button: 'Products', sections: [
        { title: 'Apparel', rows: [{ id: 'prod:1', title: 'Red Tee', description: '₹499 · 40 left' }, { id: 'prod:2', title: 'Cap' }] },
      ] } },
    });
  });

  it('sends a URL (cta_url) button', async () => {
    const { f, a } = wa();
    await a.sendReply('15551234567', { text: 'Tap to pay securely', link: { label: 'Pay ₹998', url: 'https://rzp.io/i/abc' } });
    expect(f.calls[0]!.body).toEqual({
      ...base, type: 'interactive',
      interactive: { type: 'cta_url', body: { text: 'Tap to pay securely' }, action: { name: 'cta_url', parameters: { display_text: 'Pay ₹998', url: 'https://rzp.io/i/abc' } } },
    });
  });

  it('sends plain text when the reply has no options, and normalises over-limit replies', async () => {
    const { f, a } = wa();
    await a.sendReply('15551234567', { text: 'Just text' });
    expect(f.calls[0]!.body).toMatchObject({ type: 'text', text: { body: 'Just text' } });
    await a.sendReply('15551234567', { text: 'x', buttons: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `Button number ${n} is long` })) });
    const action = (f.calls[1]!.body as { interactive: { action: { buttons: { reply: { title: string } }[] } } }).interactive.action;
    expect(action.buttons).toHaveLength(3);
    expect(action.buttons[0]!.reply.title.length).toBeLessThanOrEqual(20);
  });
});
