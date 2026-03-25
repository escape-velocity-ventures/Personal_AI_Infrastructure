/**
 * NanoClaw Session Write-Back
 *
 * Summarizes agent session transcripts and writes them to Engram
 * so future sessions can pick up where things left off.
 *
 * Usage:
 *   await writeBackSession({
 *     engramUrl: 'http://localhost:3001',
 *     token: 'jwt-token',
 *     namespace: 'personal',
 *     sessionId: 'session-abc',
 *     channel: 'slack:engineering',
 *     participants: ['alice', 'bob'],
 *     messages: conversationTranscript,
 *   });
 */

import { MemoryClient } from '../client';
import type { WriteMemoryOptions } from '../types';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface WriteBackOptions {
  engramUrl: string;
  token: string;
  namespace: string;
  sessionId: string;
  channel: string;
  participants: string[];
  messages: ConversationMessage[];
  summarizer?: (messages: ConversationMessage[]) => Promise<string>;
}

/**
 * Default summarizer using LLM endpoint.
 * Extracts key decisions, facts, action items from conversation.
 */
async function defaultSummarizer(messages: ConversationMessage[]): Promise<string> {
  const llmUrl = process.env.SUMMARIZER_LLM_URL;

  // If no LLM URL configured, return raw transcript
  if (!llmUrl || llmUrl.trim() === '') {
    return formatTranscript(messages);
  }

  try {
    // Build summarization prompt
    const transcript = formatTranscript(messages);
    const prompt = `Summarize this conversation. Extract:
1. Key decisions made
2. Facts learned
3. Action items
4. One-line summary

Conversation:
${transcript}

Summary:`;

    const response = await fetch(llmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[nanoclaw-writeback] LLM summarizer failed (HTTP ${response.status}), falling back to raw transcript`);
      return formatTranscript(messages);
    }

    const data = await response.json() as { summary?: string; text?: string; content?: string };
    const summary = data.summary ?? data.text ?? data.content;

    if (!summary) {
      console.warn('[nanoclaw-writeback] LLM response missing summary field, falling back to raw transcript');
      return formatTranscript(messages);
    }

    return summary;
  } catch (err) {
    console.warn(`[nanoclaw-writeback] Summarizer error: ${(err as Error)?.message ?? String(err)}, falling back to raw transcript`);
    return formatTranscript(messages);
  }
}

/**
 * Format conversation messages as a readable transcript.
 */
function formatTranscript(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return '(empty session)';
  }

  return messages.map(msg => {
    const timestamp = msg.timestamp ? `[${msg.timestamp}] ` : '';
    return `${timestamp}${msg.role}: ${msg.content}`;
  }).join('\n\n');
}

/**
 * Write session summary to Engram.
 * Fire-and-forget pattern: logs errors but doesn't throw.
 */
export async function writeBackSession(options: WriteBackOptions): Promise<void> {
  const {
    engramUrl,
    token,
    namespace,
    sessionId,
    channel,
    participants,
    messages,
    summarizer,
  } = options;

  try {
    // Use custom or default summarizer
    const effectiveSummarizer = summarizer ?? defaultSummarizer;
    const content = await effectiveSummarizer(messages);

    // Build tags: session_summary, channel origin
    const tags = [
      'session_summary',
      `channel:${channel}`,
    ];

    // Build source path with participants
    const sourcePath = `nanoclaw:${sessionId}:participants:${participants.join(',')}`;

    // Write to Engram
    const memoryOpts: WriteMemoryOptions = {
      sourceType: 'nanoclaw_session',
      sourcePath,
      tags,
      sessionId,
      tenantId: namespace,
      memoryType: 'episodic',
      visibility: 'shared',
      decayClass: 'standard',
    };

    // Connect to Engram - use token for auth
    // For now, we'll instantiate the client directly
    // In production, this might use JWT-authenticated HTTP API instead
    const client = new MemoryClient({
      pgUrl: process.env.ENGRAM_PG_URL ?? 'postgresql://localhost:5432/engram',
      redisUrl: process.env.ENGRAM_REDIS_URL ?? 'redis://localhost:6379',
      tenantIds: [namespace],
    });

    await client.connect();

    try {
      const memoryId = await client.remember(content, memoryOpts);
      console.log(`[nanoclaw-writeback] Session written to Engram: ${memoryId}`);
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error(`[nanoclaw-writeback] Failed to write session to Engram: ${(err as Error)?.message ?? String(err)}`);
  }
}
