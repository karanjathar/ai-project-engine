import type { ChannelName } from '../domain/types.js';

/** Outbound chat delivery port; implemented by ChannelHub. */
export interface Messenger {
  send(channel: ChannelName, to: string, text: string): Promise<void>;
}

