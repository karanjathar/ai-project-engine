import type { Logger } from 'pino';
import type { InboundMessage } from '../domain/types.js';
import type { EventBus } from '../realtime/bus.js';
import type { MessagesRepo } from '../repositories/messages.js';
import type { BotService } from './bot.js';
import type { Messenger } from './messenger.js';

/** Inbound chat pipeline: de-duplicate → log → notify dashboard → bot reply. */
export class InboxService {
  constructor(
    private readonly messages: MessagesRepo,
    private readonly events: EventBus,
    private readonly bot: BotService,
    private readonly messenger: Messenger,
    private readonly logger: Logger,
  ) {}

  async receive(msg: InboundMessage): Promise<void> {
    const text = msg.text.trim();
    if (!text) return;
    const fresh = await this.messages.logInbound({ ...msg, text });
    if (!fresh) return; // webhook retry of an already-processed message
    this.events.publish({ type: 'message.received', channel: msg.channel, from: msg.from, text: text.slice(0, 500) });
    try {
      const reply = await this.bot.handle({ ...msg, text });
      await this.messenger.send(msg.channel, msg.from, reply);
    } catch (err) {
      this.logger.error({ err, channel: msg.channel }, 'failed to process inbound message');
    }
  }
}
