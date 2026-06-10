#!/usr/bin/env bun
/**
 * PAI Bootstrap Memory Hook
 *
 * SessionStart hook: queries the memory-api /bootstrap endpoint and injects
 * recent semantic memories into the session context as a system-reminder.
 *
 * Replaces the old file-sync approach (sync-memory-from-cloud.ts + local files).
 * Reads directly from pgvector via the HTTP API — no local file scanning.
 *
 * Config (env vars):
 *   MEMORY_API_URL   — defaults to https://memory-api.escape-velocity-ventures.org
 *   MEMORY_API_KEY   — bearer token; falls back to kubectl cluster fetch
 *   PAI_AGENT_ID     — agent namespace for bootstrap (default: aurelia)
 */

import { initBridge, shouldRunSafe } from './lib/gastown-bridge';
import { execSync } from 'child_process';

const MEMORY_API_URL = process.env.MEMORY_API_URL
  ?? 'https://memory-api.escape-velocity-ventures.org';

const MAX_CHUNKS = 30;

interface MemoryChunk {
  id: string;
  content: string;
  memoryType: 'semantic' | 'episodic' | 'procedural';
  tags: string[];
  agentId: string;
  decayClass: string;
  createdAt: string;
  similarity?: number;
}

interface BootstrapResponse {
  agentId: string;
  chunks: MemoryChunk[];
  count: number;
  cacheHit: boolean;
}

// ─── API Key Resolution ───────────────────────────────────────────────────────

function resolveApiKey(): string | null {
  // 1. Environment variable (fastest)
  if (process.env.MEMORY_API_KEY) return process.env.MEMORY_API_KEY;

  // 2. Kubernetes secret — ESO-managed in infrastructure namespace
  try {
    const key = execSync(
      `kubectl get secret memory-api-key -n infrastructure -o jsonpath='{.data.api-key}' 2>/dev/null | base64 -d`,
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (key) return key;
  } catch {
    // Cluster not reachable — fall through
  }

  return null;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatChunks(chunks: MemoryChunk[]): string {
  if (chunks.length === 0) return '(no memories loaded)';

  const byType: Record<string, MemoryChunk[]> = {
    semantic:   [],
    episodic:   [],
    procedural: [],
  };

  for (const chunk of chunks) {
    (byType[chunk.memoryType] ?? byType.semantic).push(chunk);
  }

  const sections: string[] = [];

  const typeLabels: Record<string, string> = {
    semantic:   'Knowledge',
    episodic:   'Recent Activity',
    procedural: 'Procedures & Patterns',
  };

  for (const [type, label] of Object.entries(typeLabels)) {
    const group = byType[type];
    if (group.length === 0) continue;

    const items = group.map(c => {
      const tags = c.tags.length > 0 ? ` [${c.tags.join(', ')}]` : '';
      return `- ${c.content.trim()}${tags}`;
    }).join('\n');

    sections.push(`### ${label} (${group.length})\n${items}`);
  }

  return sections.join('\n\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await initBridge();
    const runResult = await shouldRunSafe({ feature: 'memory-sync' });
    if (!runResult.shouldRun) {
      console.error(`[PAI Memory] Skipped: ${runResult.reason}`);
      return;
    }

    const agentId = process.env.PAI_AGENT_ID ?? 'aurelia';
    const apiKey  = resolveApiKey();

    if (!apiKey) {
      console.error('[PAI Memory] No API key available (set MEMORY_API_KEY or ensure cluster access)');
      return;
    }

    const url = `${MEMORY_API_URL}/bootstrap?agent=${encodeURIComponent(agentId)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),  // 8s — bootstrap can be slow on cold cache
    });

    if (!response.ok) {
      console.error(`[PAI Memory] Bootstrap failed: HTTP ${response.status}`);
      return;
    }

    const data = await response.json() as BootstrapResponse;
    const chunks = data.chunks.slice(0, MAX_CHUNKS);

    if (chunks.length === 0) {
      console.error('[PAI Memory] No memories returned (corpus may be empty)');
      return;
    }

    const cacheStatus = data.cacheHit ? 'cached' : 'fresh';
    const output = `<system-reminder>
## Persistent Memory (${chunks.length} chunks, ${cacheStatus})

The following memories were loaded from pgvector at session start.
Agent: ${agentId} | Source: ${MEMORY_API_URL}

${formatChunks(chunks)}
</system-reminder>

✅ Memory bootstrapped (${chunks.length} chunks, ${cacheStatus})`;

    console.log(output);

  } catch (err) {
    // Never crash the session
    if (err instanceof Error && err.name === 'TimeoutError') {
      console.error('[PAI Memory] Bootstrap timed out — proceeding without memory context');
    } else {
      console.error('[PAI Memory] Bootstrap error:', err);
    }
  }
}

main();
