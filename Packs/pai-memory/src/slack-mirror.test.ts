import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import {
  CHANNEL_MAP,
  EVENT_EMOJI,
  formatSlackMessage,
  startSlackMirror,
  type SlackMirrorConfig,
  type SlackMirrorHandle,
} from './slack-mirror';
import type { StoredEvent, HandoffEventType } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 'evt-001',
    type: 'BEAD_CREATED',
    source: 'aurelia',
    urgency: 'normal',
    payload: { title: 'Implement feature X' },
    timestamp: '2026-04-04T12:00:00.000Z',
    ...overrides,
  };
}

// ── Channel Mapping ──────────────────────────────────────────────────────────

describe('CHANNEL_MAP', () => {
  it('maps BEAD_CREATED to #development', () => {
    expect(CHANNEL_MAP.BEAD_CREATED).toBe('#development');
  });

  it('maps REVIEW_REQUESTED to #code-reviews', () => {
    expect(CHANNEL_MAP.REVIEW_REQUESTED).toBe('#code-reviews');
  });

  it('maps REVIEW_COMPLETED to #code-reviews', () => {
    expect(CHANNEL_MAP.REVIEW_COMPLETED).toBe('#code-reviews');
  });

  it('maps DEPLOY_COMPLETE to #monitoring', () => {
    expect(CHANNEL_MAP.DEPLOY_COMPLETE).toBe('#monitoring');
  });

  it('maps ALERT_RESOLVED to #monitoring', () => {
    expect(CHANNEL_MAP.ALERT_RESOLVED).toBe('#monitoring');
  });

  it('maps ESCALATE_HUMAN to #incidents', () => {
    expect(CHANNEL_MAP.ESCALATE_HUMAN).toBe('#incidents');
  });
});

// ── Event Emojis ─────────────────────────────────────────────────────────────

describe('EVENT_EMOJI', () => {
  it('has an emoji for every mapped event type', () => {
    for (const type of Object.keys(CHANNEL_MAP)) {
      expect(EVENT_EMOJI[type as HandoffEventType]).toBeDefined();
    }
  });
});

// ── Message Formatting ───────────────────────────────────────────────────────

describe('formatSlackMessage', () => {
  it('includes event type emoji and type in header', () => {
    const event = makeEvent();
    const msg = formatSlackMessage(event);
    expect(msg.text).toContain('BEAD_CREATED');
    expect(msg.blocks).toBeDefined();
    expect(msg.blocks!.length).toBeGreaterThan(0);
  });

  it('includes source agent name', () => {
    const event = makeEvent({ source: 'cybill' });
    const msg = formatSlackMessage(event);
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain('cybill');
  });

  it('includes bead ID when present', () => {
    const event = makeEvent({ beadId: 'PAI-abc' });
    const msg = formatSlackMessage(event);
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain('PAI-abc');
  });

  it('omits bead ID field when absent', () => {
    const event = makeEvent({ beadId: undefined });
    const msg = formatSlackMessage(event);
    const text = JSON.stringify(msg.blocks);
    expect(text).not.toContain('Bead');
  });

  it('includes timestamp', () => {
    const event = makeEvent({ timestamp: '2026-04-04T12:00:00.000Z' });
    const msg = formatSlackMessage(event);
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain('2026-04-04');
  });

  it('includes payload summary', () => {
    const event = makeEvent({ payload: { title: 'Deploy to prod', env: 'production' } });
    const msg = formatSlackMessage(event);
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain('Deploy to prod');
  });

  it('truncates long payload summaries', () => {
    const longPayload: Record<string, unknown> = { data: 'x'.repeat(500) };
    const event = makeEvent({ payload: longPayload });
    const msg = formatSlackMessage(event);
    // Fallback text should be under 300 chars
    expect(msg.text.length).toBeLessThanOrEqual(300);
  });

  it('marks urgent events', () => {
    const event = makeEvent({ urgency: 'immediate' });
    const msg = formatSlackMessage(event);
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain('URGENT');
  });
});

// ── Channel Override ─────────────────────────────────────────────────────────

describe('startSlackMirror channel overrides', () => {
  let subscribedChannels: string[] = [];
  let messageHandler: ((message: string, channel: string) => void) | null = null;
  let postedMessages: Array<{ channel: string; text: string }> = [];

  const mockRedisClient = {
    duplicate: () => ({
      connect: async () => {},
      pSubscribe: async (pattern: string, handler: (msg: string, channel: string) => void) => {
        subscribedChannels.push(pattern);
        messageHandler = handler;
      },
      pUnsubscribe: async () => {},
      quit: async () => {},
      on: () => {},
    }),
  };

  const mockSlackClient = {
    chat: {
      postMessage: async (args: { channel: string; text: string }) => {
        postedMessages.push({ channel: args.channel, text: args.text });
        return { ok: true };
      },
    },
  };

  beforeEach(() => {
    subscribedChannels = [];
    messageHandler = null;
    postedMessages = [];
  });

  it('subscribes to event:* pattern', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    expect(subscribedChannels).toContain('event:*');
    await handle.stop();
  });

  it('posts to default channel when no override configured', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    const event = makeEvent({ type: 'BEAD_CREATED' });
    messageHandler!(JSON.stringify(event), 'event:BEAD_CREATED');

    // Allow async post to complete
    await new Promise(r => setTimeout(r, 50));

    expect(postedMessages.length).toBe(1);
    expect(postedMessages[0].channel).toBe('#development');
    await handle.stop();
  });

  it('uses channel override when configured', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      channelOverrides: { development: 'C12345' },
      _slackClientOverride: mockSlackClient as any,
    });

    const event = makeEvent({ type: 'BEAD_CREATED' });
    messageHandler!(JSON.stringify(event), 'event:BEAD_CREATED');

    await new Promise(r => setTimeout(r, 50));

    expect(postedMessages.length).toBe(1);
    expect(postedMessages[0].channel).toBe('C12345');
    await handle.stop();
  });

  it('drops events with unmapped types silently', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    const event = makeEvent({ type: 'BEAD_DISPATCHED' as any });
    messageHandler!(JSON.stringify(event), 'event:BEAD_DISPATCHED');

    await new Promise(r => setTimeout(r, 50));

    expect(postedMessages.length).toBe(0);
    await handle.stop();
  });

  it('handles malformed JSON gracefully', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    // Should not throw
    messageHandler!('not-json', 'event:BEAD_CREATED');

    await new Promise(r => setTimeout(r, 50));

    expect(postedMessages.length).toBe(0);
    await handle.stop();
  });

  it('catches Slack API errors without crashing', async () => {
    const failingSlack = {
      chat: {
        postMessage: async () => { throw new Error('rate_limited'); },
      },
    };

    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: failingSlack as any,
    });

    const event = makeEvent();
    // Should not throw
    messageHandler!(JSON.stringify(event), 'event:BEAD_CREATED');

    await new Promise(r => setTimeout(r, 50));
    await handle.stop();
  });

  it('posts review events to code-reviews channel', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    const event = makeEvent({ type: 'REVIEW_REQUESTED', source: 'sprint-agent' });
    messageHandler!(JSON.stringify(event), 'event:REVIEW_REQUESTED');

    await new Promise(r => setTimeout(r, 50));

    expect(postedMessages[0].channel).toBe('#code-reviews');
    await handle.stop();
  });

  it('posts escalation events to incidents channel', async () => {
    const handle = await startSlackMirror({
      redisClient: mockRedisClient as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    const event = makeEvent({ type: 'ESCALATE_HUMAN', urgency: 'immediate' });
    messageHandler!(JSON.stringify(event), 'event:ESCALATE_HUMAN');

    await new Promise(r => setTimeout(r, 50));

    expect(postedMessages[0].channel).toBe('#incidents');
    await handle.stop();
  });

  it('stop() cleans up subscriber connection', async () => {
    let unsubscribed = false;
    let quit = false;
    const trackingRedis = {
      duplicate: () => ({
        connect: async () => {},
        pSubscribe: async (pattern: string, handler: (msg: string, ch: string) => void) => {
          messageHandler = handler;
        },
        pUnsubscribe: async () => { unsubscribed = true; },
        quit: async () => { quit = true; },
        on: () => {},
      }),
    };

    const handle = await startSlackMirror({
      redisClient: trackingRedis as any,
      slackToken: 'xoxb-test',
      _slackClientOverride: mockSlackClient as any,
    });

    await handle.stop();
    expect(unsubscribed).toBe(true);
    expect(quit).toBe(true);
  });
});
