/**
 * Engram MCP Tool & Resource Factory
 *
 * Shared between stdio transport (mcp-server.ts) and remote HTTP transport
 * (server.ts /mcp route). Each tool callback reads extra.authInfo?.token so
 * the bearer token flows end-to-end from the remote caller through to the
 * HTTP API's own auth middleware.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Extra {
  authInfo?: { token: string };
  [key: string]: unknown;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createMcpServer(apiUrl: string, defaultToken: string): McpServer {
  const API_URL = apiUrl.replace(/\/$/, '');

  // ── Fetch helper ────────────────────────────────────────────────────────
  async function api(path: string, token: string, opts: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> ?? {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(`${API_URL}${path}`, { ...opts, headers });
  }

  /** Resolve token: prefer per-request authInfo, fall back to default. */
  function tok(extra: Extra): string {
    return extra?.authInfo?.token ?? defaultToken;
  }

  // ── Response helpers ──────────────────────────────────────────────────
  function ok(data: unknown) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    };
  }

  function err(message: string) {
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
    };
  }

  // ── Server ────────────────────────────────────────────────────────────
  const server = new McpServer({
    name: 'engram',
    version: '1.0.0',
  });

  // ── Tools ─────────────────────────────────────────────────────────────

  server.tool(
    'engram_search',
    'Search memories using semantic (vector), full-text (FTS), or hybrid search. Returns ranked memory chunks with similarity scores.',
    {
      query: z.string().describe('The search query text'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
      mode: z.enum(['vector', 'fts', 'hybrid']).optional().describe('Search mode (default: hybrid)'),
      memoryType: z.enum(['semantic', 'episodic', 'procedural']).optional().describe('Filter by memory type'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      minSimilarity: z.number().optional().describe('Minimum similarity threshold (0-1)'),
      scopes: z.array(z.enum(['personal', 'org', 'team'])).optional().describe('Filter by scope'),
    },
    async (args, extra: Extra) => {
      try {
        const res = await api('/search', tok(extra), {
          method: 'POST',
          body: JSON.stringify(args),
        });
        if (!res.ok) return err(`Search failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Search error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_remember',
    'Store a new memory chunk. Memories are automatically embedded for semantic search.',
    {
      content: z.string().describe('The memory content to store'),
      memoryType: z.enum(['semantic', 'episodic', 'procedural']).optional().describe('Memory type (default: semantic)'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      sourcePath: z.string().optional().describe('Source file or URL'),
      sourceType: z.string().optional().describe('Source type identifier'),
      visibility: z.enum(['shared', 'private']).optional().describe('Visibility (default: shared)'),
      decayClass: z.enum(['standard', 'ephemeral', 'long-term']).optional().describe('Decay class (default: standard)'),
      sessionId: z.string().optional().describe('Session ID to associate with'),
      scope: z.enum(['personal', 'org', 'team']).optional().describe('Tenant scope'),
    },
    async (args, extra: Extra) => {
      try {
        const res = await api('/remember', tok(extra), {
          method: 'POST',
          body: JSON.stringify(args),
        });
        if (!res.ok) return err(`Remember failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Remember error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_get',
    'Fetch a specific memory chunk by its ID.',
    {
      id: z.string().describe('The memory chunk ID (UUID)'),
    },
    async (args, extra: Extra) => {
      try {
        const res = await api(`/chunk/${encodeURIComponent(args.id)}`, tok(extra));
        if (!res.ok) return err(`Get failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Get error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_update',
    'Update an existing memory chunk. Only provided fields are changed.',
    {
      id: z.string().describe('The memory chunk ID (UUID)'),
      content: z.string().optional().describe('New content (re-embeds automatically)'),
      tags: z.array(z.string()).optional().describe('Replace tags'),
      memoryType: z.enum(['semantic', 'episodic', 'procedural']).optional().describe('Change memory type'),
      visibility: z.enum(['shared', 'private']).optional().describe('Change visibility'),
      decayClass: z.enum(['standard', 'ephemeral', 'long-term']).optional().describe('Change decay class'),
      scope: z.enum(['personal', 'org', 'team']).optional().describe('Change scope'),
    },
    async (args, extra: Extra) => {
      try {
        const { id, ...body } = args;
        const res = await api(`/chunk/${encodeURIComponent(id)}`, tok(extra), {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        if (!res.ok) return err(`Update failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Update error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_forget',
    'Permanently delete a memory chunk by ID.',
    {
      id: z.string().describe('The memory chunk ID (UUID) to delete'),
    },
    async (args, extra: Extra) => {
      try {
        const res = await api(`/chunk/${encodeURIComponent(args.id)}`, tok(extra), {
          method: 'DELETE',
        });
        if (!res.ok) return err(`Forget failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Forget error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_entity',
    'Look up a named entity and optionally retrieve its related memory chunks.',
    {
      name: z.string().describe('Entity name to look up'),
      includeChunks: z.boolean().optional().describe('Also fetch related memory chunks (default: false)'),
      chunkLimit: z.number().optional().describe('Max related chunks to return (default: 20)'),
    },
    async (args, extra: Extra) => {
      try {
        const t = tok(extra);
        const res = await api(`/entity/${encodeURIComponent(args.name)}`, t);
        if (!res.ok) return err(`Entity lookup failed: ${res.status} ${await res.text()}`);
        const entity = await res.json();

        if (args.includeChunks) {
          const limit = args.chunkLimit ?? 20;
          const chunksRes = await api(`/entity/${encodeURIComponent(args.name)}/chunks?limit=${limit}`, t);
          if (chunksRes.ok) {
            const chunksData = await chunksRes.json();
            return ok({ entity, chunks: chunksData.chunks, chunkCount: chunksData.count });
          }
        }

        return ok(entity);
      } catch (e) {
        return err(`Entity error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_bootstrap',
    'Get cold-start context for a new session. Returns the most relevant recent memories, entities, and patterns to prime an agent.',
    {},
    async (_args: Record<string, never>, extra: Extra) => {
      try {
        const res = await api('/bootstrap', tok(extra));
        if (!res.ok) return err(`Bootstrap failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Bootstrap error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_session_read',
    'Read a session scratchpad. Sessions store ephemeral key-value state in Redis.',
    {
      id: z.string().describe('Session ID'),
    },
    async (args, extra: Extra) => {
      try {
        const res = await api(`/session/${encodeURIComponent(args.id)}`, tok(extra));
        if (!res.ok) return err(`Session read failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Session read error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_session_write',
    'Write to a session scratchpad. Stores arbitrary JSON state in Redis with optional TTL.',
    {
      id: z.string().describe('Session ID'),
      state: z.record(z.string(), z.unknown()).describe('JSON state to store'),
      ttl: z.number().optional().describe('TTL in seconds (default: 604800 = 7 days)'),
    },
    async (args, extra: Extra) => {
      try {
        const ttlParam = args.ttl ? `?ttl=${args.ttl}` : '';
        const res = await api(`/session/${encodeURIComponent(args.id)}${ttlParam}`, tok(extra), {
          method: 'PUT',
          body: JSON.stringify(args.state),
        });
        if (!res.ok) return err(`Session write failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Session write error: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    'engram_patterns',
    'Find repeated command patterns from the command log. Useful for discovering common workflows and automation opportunities.',
    {
      minCount: z.number().optional().describe('Minimum occurrence count (default: 3)'),
      days: z.number().optional().describe('Look-back window in days (default: 30)'),
      toolName: z.string().optional().describe('Filter by tool name'),
    },
    async (args, extra: Extra) => {
      try {
        const params = new URLSearchParams();
        if (args.minCount !== undefined) params.set('minCount', String(args.minCount));
        if (args.days !== undefined) params.set('days', String(args.days));
        if (args.toolName) params.set('toolName', args.toolName);

        const qs = params.toString();
        const res = await api(`/patterns${qs ? `?${qs}` : ''}`, tok(extra));
        if (!res.ok) return err(`Patterns failed: ${res.status} ${await res.text()}`);
        return ok(await res.json());
      } catch (e) {
        return err(`Patterns error: ${(e as Error).message}`);
      }
    },
  );

  // ── Resources ─────────────────────────────────────────────────────────

  server.resource(
    'engram_stats',
    'engram://stats',
    { description: 'Corpus statistics: chunk count, entity count, command count, backend health, and pool stats.' },
    async (_uri: URL, extra: Extra) => {
      try {
        const res = await api('/stats', tok(extra));
        if (!res.ok) return { contents: [{ uri: 'engram://stats', text: `Error: ${res.status}`, mimeType: 'text/plain' }] };
        const data = await res.json();
        return { contents: [{ uri: 'engram://stats', text: JSON.stringify(data, null, 2), mimeType: 'application/json' }] };
      } catch (e) {
        return { contents: [{ uri: 'engram://stats', text: `Error: ${(e as Error).message}`, mimeType: 'text/plain' }] };
      }
    },
  );

  server.resource(
    'engram_bootstrap_context',
    'engram://bootstrap',
    { description: 'Cold-start context as a pullable resource. Contains recent memories, entities, and patterns for session priming.' },
    async (_uri: URL, extra: Extra) => {
      try {
        const res = await api('/bootstrap', tok(extra));
        if (!res.ok) return { contents: [{ uri: 'engram://bootstrap', text: `Error: ${res.status}`, mimeType: 'text/plain' }] };
        const data = await res.json();
        return { contents: [{ uri: 'engram://bootstrap', text: JSON.stringify(data, null, 2), mimeType: 'application/json' }] };
      } catch (e) {
        return { contents: [{ uri: 'engram://bootstrap', text: `Error: ${(e as Error).message}`, mimeType: 'text/plain' }] };
      }
    },
  );

  return server;
}
