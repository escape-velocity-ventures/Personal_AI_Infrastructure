import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';
import { writeBackSession, type WriteBackOptions, type ConversationMessage } from './nanoclaw-writeback';
import { MemoryClient } from '../client';

// ── Mock Setup ────────────────────────────────────────────────────────

let mockRemember: ReturnType<typeof mock>;
let mockConnect: ReturnType<typeof mock>;
let mockDisconnect: ReturnType<typeof mock>;

beforeEach(() => {
  // Spy on MemoryClient constructor and instance methods
  mockRemember = mock(async () => 'test-memory-id');
  mockConnect = mock(async () => {});
  mockDisconnect = mock(async () => {});

  spyOn(MemoryClient.prototype, 'remember').mockImplementation(mockRemember);
  spyOn(MemoryClient.prototype, 'connect').mockImplementation(mockConnect);
  spyOn(MemoryClient.prototype, 'disconnect').mockImplementation(mockDisconnect);
});

// ── Test Fixtures ─────────────────────────────────────────────────────

const sampleMessages: ConversationMessage[] = [
  { role: 'user', content: 'How do I deploy to production?', timestamp: '2026-03-25T10:00:00Z' },
  { role: 'assistant', content: 'Use the deploy script with --env=production flag.', timestamp: '2026-03-25T10:00:15Z' },
  { role: 'user', content: 'What about rollback?', timestamp: '2026-03-25T10:01:00Z' },
  { role: 'assistant', content: 'Run deploy --rollback --version=previous', timestamp: '2026-03-25T10:01:10Z' },
];

const baseOptions: Omit<WriteBackOptions, 'messages'> = {
  engramUrl: 'http://localhost:3001',
  token: 'test-token',
  namespace: 'personal',
  sessionId: 'test-session-123',
  channel: 'slack:engineering',
  participants: ['alice', 'bob'],
};

// ── Tests ─────────────────────────────────────────────────────────────

describe('writeBackSession', () => {
  beforeEach(() => {
    mockRemember.mockClear();
    mockConnect.mockClear();
    mockDisconnect.mockClear();
  });

  it('writes session summary to Engram with metadata', async () => {
    await writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
      summarizer: async () => 'Summary: deployment and rollback discussion',
    });

    expect(mockRemember).toHaveBeenCalledTimes(1);
    const call = mockRemember.mock.calls[0];
    const [content, opts] = call;

    // Content should be the summary
    expect(content).toContain('deployment and rollback discussion');

    // Metadata should include channel, participants, session ID
    expect(opts.tags).toContain('session_summary');
    expect(opts.tags).toContain('channel:slack:engineering');
    expect(opts.sessionId).toBe('test-session-123');
    expect(opts.sourcePath).toContain('participants:alice,bob');
  });

  it('stores raw transcript when no summarizer provided', async () => {
    await writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
    });

    expect(mockRemember).toHaveBeenCalledTimes(1);
    const call = mockRemember.mock.calls[0];
    const [content] = call;

    // Content should include messages from the transcript
    expect(content).toContain('How do I deploy to production?');
    expect(content).toContain('Use the deploy script');
  });

  it('includes proper metadata tags for filtering', async () => {
    await writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
      summarizer: async () => 'Test summary',
    });

    const call = mockRemember.mock.calls[0];
    const [, opts] = call;

    expect(opts.tags).toContain('session_summary');
    expect(opts.tags).toContain('channel:slack:engineering');
    expect(opts.sourceType).toBe('nanoclaw_session');
  });

  it('handles empty message array gracefully', async () => {
    await writeBackSession({
      ...baseOptions,
      messages: [],
    });

    // Should still write (with empty/minimal content)
    expect(mockRemember).toHaveBeenCalledTimes(1);
  });

  it('does not throw on Engram write failure (fire-and-forget)', async () => {
    mockRemember.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await expect(writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
    })).resolves.toBeUndefined();
  });

  it('formats transcript with role labels and timestamps', async () => {
    await writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
    });

    const call = mockRemember.mock.calls[0];
    const [content] = call;

    // Should include role labels
    expect(content).toContain('user:');
    expect(content).toContain('assistant:');

    // Should include timestamps if available
    expect(content).toContain('2026-03-25');
  });

  it('passes namespace as tenantId', async () => {
    await writeBackSession({
      ...baseOptions,
      namespace: 'org:acme',
      messages: sampleMessages,
      summarizer: async () => 'Summary',
    });

    const call = mockRemember.mock.calls[0];
    const [, opts] = call;

    expect(opts.tenantId).toBe('org:acme');
  });
});

// ── Summarizer Tests ──────────────────────────────────────────────────

describe('default summarizer (via LLM)', () => {
  it('skips LLM call if SUMMARIZER_LLM_URL is empty', async () => {
    const origEnv = process.env.SUMMARIZER_LLM_URL;
    process.env.SUMMARIZER_LLM_URL = '';

    await writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
    });

    // Should fall back to raw transcript
    const call = mockRemember.mock.calls[0];
    const [content] = call;
    expect(content).toContain('How do I deploy to production?');

    process.env.SUMMARIZER_LLM_URL = origEnv;
  });

  it('calls LLM endpoint when SUMMARIZER_LLM_URL is set', async () => {
    const origEnv = process.env.SUMMARIZER_LLM_URL;
    const origFetch = globalThis.fetch;

    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ summary: 'LLM-generated summary' }),
    }));
    globalThis.fetch = mockFetch as any;
    process.env.SUMMARIZER_LLM_URL = 'http://localhost:11434/v1/completions';

    await writeBackSession({
      ...baseOptions,
      messages: sampleMessages,
    });

    expect(mockFetch).toHaveBeenCalled();

    const call = mockRemember.mock.calls[0];
    const [content] = call;
    expect(content).toContain('LLM-generated summary');

    globalThis.fetch = origFetch;
    process.env.SUMMARIZER_LLM_URL = origEnv;
  });
});
