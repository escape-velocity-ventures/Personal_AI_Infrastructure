/**
 * NanoClaw Bootstrap Hook
 *
 * Semantic memory integration for NanoClaw container-isolated agents.
 * At session start, fetches relevant memories from Engram via semantic search
 * and formats them for LLM context injection.
 *
 * Usage:
 *   import { bootstrapFromEngram } from './integrations/nanoclaw-bootstrap';
 *   const context = await bootstrapFromEngram({
 *     engramUrl: 'http://memory-api.memory.svc:3000',
 *     token: 'jwt-token',
 *     namespace: 'my-namespace',
 *     query: 'deployment patterns kubernetes',
 *     limit: 10
 *   });
 *   // Inject context into LLM system prompt
 */

import type { MemoryChunk } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BootstrapOptions {
  /** Engram API base URL */
  engramUrl: string;
  /** JWT token for authentication */
  token: string;
  /** Namespace/tenant filter */
  namespace: string;
  /** Semantic search query (typically session topic or first user message) */
  query: string;
  /** Maximum memories to retrieve (default: 10) */
  limit?: number;
  /** Minimum similarity threshold (default: 0.5) */
  minSimilarity?: number;
  /** Memory type filter (optional) */
  memoryType?: 'semantic' | 'episodic' | 'procedural';
  /** Tag filters (optional) */
  tags?: string[];
}

export interface BootstrapResult {
  /** Formatted context ready for LLM injection */
  context: string;
  /** Number of memories retrieved */
  count: number;
  /** Whether Engram was reachable */
  available: boolean;
  /** Error message if bootstrap failed */
  error?: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Bootstrap NanoClaw session with relevant memories from Engram.
 * Performs semantic search and formats results for LLM context.
 *
 * Graceful degradation:
 * - If Engram is unreachable: returns empty context (no crash)
 * - If no memories match: returns empty context (valid state)
 * - Network timeout: 5 second limit
 *
 * @returns Formatted memory context string
 */
export async function bootstrapFromEngram(
  options: BootstrapOptions
): Promise<BootstrapResult> {
  const {
    engramUrl,
    token,
    namespace,
    query,
    limit = 10,
    minSimilarity = 0.5,
    memoryType,
    tags,
  } = options;

  try {
    // Call Engram /search endpoint with semantic query
    const response = await fetch(`${engramUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        limit,
        minSimilarity,
        memoryType,
        tags,
        mode: 'hybrid', // Semantic + FTS for best recall
      }),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      const status = response.status;
      const text = await response.text().catch(() => 'unknown error');
      console.warn(
        `[nanoclaw-bootstrap] Engram returned ${status}: ${text.slice(0, 200)}`
      );
      return {
        context: '',
        count: 0,
        available: false,
        error: `Engram API error: ${status}`,
      };
    }

    const data = (await response.json()) as {
      results: MemoryChunk[];
      count: number;
    };
    const memories = data.results ?? [];

    // No memories found is a valid state, not an error
    if (memories.length === 0) {
      return {
        context: '',
        count: 0,
        available: true,
      };
    }

    // Format memories for LLM context injection
    const context = formatMemoriesForLLM(memories, namespace);

    return {
      context,
      count: memories.length,
      available: true,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.warn(`[nanoclaw-bootstrap] Failed to fetch memories: ${message}`);

    // Graceful degradation: empty context, log warning, continue
    return {
      context: '',
      count: 0,
      available: false,
      error: message,
    };
  }
}

/**
 * Format memory chunks into structured text blocks for LLM consumption.
 *
 * Output format:
 * ```
 * # Relevant Memories (N)
 *
 * ## Memory 1: [tags]
 * Source: path/to/file.md
 * Created: 2026-03-25
 * Similarity: 0.87
 *
 * [content]
 *
 * ---
 *
 * ## Memory 2: ...
 * ```
 */
function formatMemoriesForLLM(
  memories: MemoryChunk[],
  namespace: string
): string {
  const lines: string[] = [];

  lines.push(`# Relevant Memories (${memories.length})`);
  lines.push('');
  lines.push(
    `The following memories were retrieved from namespace "${namespace}" based on semantic similarity to your current task.`
  );
  lines.push('');

  memories.forEach((mem, idx) => {
    const num = idx + 1;

    // Header with tags
    const tagStr = mem.tags?.length ? ` [${mem.tags.join(', ')}]` : '';
    lines.push(`## Memory ${num}${tagStr}`);

    // Metadata
    if (mem.sourcePath) {
      lines.push(`**Source:** \`${mem.sourcePath}\``);
    }
    if (mem.memoryType) {
      lines.push(`**Type:** ${mem.memoryType}`);
    }
    if (mem.createdAt) {
      const date = new Date(mem.createdAt).toISOString().split('T')[0];
      lines.push(`**Created:** ${date}`);
    }
    if (mem.similarity !== undefined) {
      lines.push(`**Similarity:** ${mem.similarity.toFixed(2)}`);
    }
    lines.push('');

    // Content
    lines.push(mem.content.trim());
    lines.push('');

    // Separator between memories (except after last one)
    if (num < memories.length) {
      lines.push('---');
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * Convenience function for HTTP-only environments (no MemoryClient).
 * Uses fetch API directly to call Engram's /bootstrap endpoint.
 *
 * This returns the standard bootstrap context (curated + memory-md tags)
 * rather than a semantic search. Use this for cold-start context when
 * you don't have a specific query yet.
 */
export async function fetchBootstrapContext(
  engramUrl: string,
  token: string
): Promise<BootstrapResult> {
  try {
    const response = await fetch(`${engramUrl}/bootstrap`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const status = response.status;
      console.warn(`[nanoclaw-bootstrap] Bootstrap endpoint returned ${status}`);
      return {
        context: '',
        count: 0,
        available: false,
        error: `Bootstrap API error: ${status}`,
      };
    }

    const data = (await response.json()) as {
      chunks: MemoryChunk[];
      count: number;
    };
    const memories = data.chunks ?? [];

    if (memories.length === 0) {
      return {
        context: '',
        count: 0,
        available: true,
      };
    }

    // Format curated memories (no namespace needed for bootstrap)
    const context = formatBootstrapMemories(memories);

    return {
      context,
      count: memories.length,
      available: true,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.warn(`[nanoclaw-bootstrap] Bootstrap fetch failed: ${message}`);
    return {
      context: '',
      count: 0,
      available: false,
      error: message,
    };
  }
}

/**
 * Format bootstrap memories (curated content).
 * Simpler formatting than semantic search results.
 */
function formatBootstrapMemories(memories: MemoryChunk[]): string {
  const lines: string[] = [];

  lines.push(`# Bootstrap Context (${memories.length} curated memories)`);
  lines.push('');

  memories.forEach((mem) => {
    // Simple format: just source + content
    if (mem.sourcePath) {
      lines.push(`### ${mem.sourcePath}`);
    } else if (mem.tags?.length) {
      lines.push(`### [${mem.tags.join(', ')}]`);
    }
    lines.push('');
    lines.push(mem.content.trim());
    lines.push('');
  });

  return lines.join('\n');
}
