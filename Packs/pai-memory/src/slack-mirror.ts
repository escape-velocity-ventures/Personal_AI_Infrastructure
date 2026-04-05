/**
 * Slack Mirror — subscribes to Engram event bus (Redis pub/sub) and
 * cross-posts formatted summaries to Slack channels.
 *
 * Events are published by Engram's publishEvent() to `event:{TYPE}` Redis
 * channels. This module subscribes via pSubscribe('event:*') and posts
 * a formatted Slack Block Kit message to the mapped channel.
 *
 * Non-blocking: Slack post errors are logged but never crash the pipeline.
 */

import type { RedisClientType } from 'redis';
import type { StoredEvent, HandoffEventType } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SlackMirrorConfig {
  /** Existing Redis client (we call .duplicate() to get our own subscriber) */
  redisClient: RedisClientType;
  /** Slack bot token (xoxb-...) */
  slackToken: string;
  /** Override default channel names with Slack channel IDs */
  channelOverrides?: {
    development?: string;
    code_reviews?: string;
    monitoring?: string;
    incidents?: string;
  };
  /** Internal: inject a mock Slack client for testing */
  _slackClientOverride?: SlackWebClient;
}

export interface SlackMirrorHandle {
  stop: () => Promise<void>;
}

/** Minimal interface matching @slack/web-api WebClient.chat.postMessage */
interface SlackWebClient {
  chat: {
    postMessage: (args: {
      channel: string;
      text: string;
      blocks?: unknown[];
      unfurl_links?: boolean;
    }) => Promise<{ ok: boolean }>;
  };
}

// ── Channel Mapping ──────────────────────────────────────────────────────────

/** Default channel for each event type. Keys are HandoffEventType values. */
export const CHANNEL_MAP: Partial<Record<HandoffEventType, string>> = {
  BEAD_CREATED:     '#development',
  REVIEW_REQUESTED: '#code-reviews',
  REVIEW_COMPLETED: '#code-reviews',
  DEPLOY_COMPLETE:  '#monitoring',
  ALERT_RESOLVED:   '#monitoring',
  ESCALATE_HUMAN:   '#incidents',
};

/** Channel key for resolving overrides */
const CHANNEL_KEY: Partial<Record<HandoffEventType, keyof NonNullable<SlackMirrorConfig['channelOverrides']>>> = {
  BEAD_CREATED:     'development',
  REVIEW_REQUESTED: 'code_reviews',
  REVIEW_COMPLETED: 'code_reviews',
  DEPLOY_COMPLETE:  'monitoring',
  ALERT_RESOLVED:   'monitoring',
  ESCALATE_HUMAN:   'incidents',
};

// ── Emojis ───────────────────────────────────────────────────────────────────

export const EVENT_EMOJI: Partial<Record<HandoffEventType, string>> = {
  BEAD_CREATED:     ':new:',
  REVIEW_REQUESTED: ':eyes:',
  REVIEW_COMPLETED: ':white_check_mark:',
  DEPLOY_COMPLETE:  ':rocket:',
  ALERT_RESOLVED:   ':green_heart:',
  ESCALATE_HUMAN:   ':rotating_light:',
};

// ── Message Formatting ───────────────────────────────────────────────────────

export function formatSlackMessage(event: StoredEvent): {
  text: string;
  blocks: unknown[];
} {
  const emoji = EVENT_EMOJI[event.type] ?? ':bell:';
  const isUrgent = event.urgency === 'immediate';
  const urgentPrefix = isUrgent ? ':warning: *URGENT* ' : '';

  // Build payload summary (truncated)
  const payloadStr = Object.entries(event.payload)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  const payloadSummary = payloadStr.length > 200 ? payloadStr.slice(0, 197) + '...' : payloadStr;

  // Fallback text (always under 300 chars)
  const fallbackRaw = `${emoji} ${urgentPrefix}${event.type} from ${event.source}${event.beadId ? ` [${event.beadId}]` : ''}: ${payloadSummary}`;
  const text = fallbackRaw.length > 300 ? fallbackRaw.slice(0, 297) + '...' : fallbackRaw;

  // Build Block Kit blocks
  const blocks: unknown[] = [];

  // Header section
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${emoji} ${urgentPrefix}*${event.type}*`,
    },
  });

  // Fields: source, timestamp, optional bead
  const fields: Array<{ type: string; text: string }> = [
    { type: 'mrkdwn', text: `*Source:* ${event.source}` },
    { type: 'mrkdwn', text: `*Time:* ${event.timestamp}` },
  ];
  if (event.beadId) {
    fields.push({ type: 'mrkdwn', text: `*Bead:* \`${event.beadId}\`` });
  }

  blocks.push({
    type: 'section',
    fields,
  });

  // Payload context
  if (payloadSummary) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: payloadSummary },
      ],
    });
  }

  return { text, blocks };
}

// ── Start Mirror ─────────────────────────────────────────────────────────────

export async function startSlackMirror(config: SlackMirrorConfig): Promise<SlackMirrorHandle> {
  const { redisClient, slackToken, channelOverrides = {} } = config;

  // Create Slack client (or use injected mock)
  let slack: SlackWebClient;
  if (config._slackClientOverride) {
    slack = config._slackClientOverride;
  } else {
    // Dynamic import to avoid requiring @slack/web-api when mirroring is disabled
    const { WebClient } = await import('@slack/web-api');
    slack = new WebClient(slackToken) as unknown as SlackWebClient;
  }

  // Create dedicated Redis subscriber
  const sub = redisClient.duplicate() as any;
  sub.on?.('error', (e: Error) => console.error('[slack-mirror:redis]', e.message));
  await sub.connect();

  // Handler for pattern-subscribed messages
  const handler = async (message: string, channel: string) => {
    try {
      const event: StoredEvent = JSON.parse(message);
      const eventType = event.type as HandoffEventType;

      // Only mirror events we have a channel mapping for
      const defaultChannel = CHANNEL_MAP[eventType];
      if (!defaultChannel) return;

      // Resolve channel (override or default)
      const overrideKey = CHANNEL_KEY[eventType];
      const targetChannel = (overrideKey && channelOverrides[overrideKey]) ?? defaultChannel;

      const { text, blocks } = formatSlackMessage(event);

      await slack.chat.postMessage({
        channel: targetChannel,
        text,
        blocks,
        unfurl_links: false,
      });
    } catch (err) {
      // Never crash the event pipeline
      console.error('[slack-mirror] Error processing event:', (err as Error).message);
    }
  };

  // Subscribe to all event channels
  await sub.pSubscribe('event:*', handler);

  console.log('[slack-mirror] Listening for events on event:*');

  return {
    stop: async () => {
      await sub.pUnsubscribe('event:*');
      await sub.quit();
      console.log('[slack-mirror] Stopped');
    },
  };
}
