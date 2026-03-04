/**
 * pai-memory — MemoryClient
 *
 * Unified interface for the shared memory system:
 *   - pgvector: persistent storage, vector search, entity graph, command log
 *   - Redis: bootstrap cache, pub/sub for cross-agent events, session scratchpad
 *
 * Usage:
 *   const mem = new MemoryClient({ pgUrl, redisUrl });
 *   await mem.connect();
 *   const ctx = await mem.bootstrap();   // cold-start context
 *   await mem.remember('learned X', { tags: ['project-y'] });
 *   const results = await mem.search('deploy-guard architecture');
 */

import { createHash } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { createClient, type RedisClientType } from 'redis';
import type {
  MemoryChunk, WriteMemoryOptions, SearchOptions,
  Entity, CommandEntry, PatternResult, MemoryClientConfig, PoolStats,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANNELS = {
  MEMORY_NEW:        'memory:new',
  MEMORY_BOOTSTRAP:  'memory:bootstrap-invalidated',
  COMMAND_RAN:       'memory:command-ran',
} as const;

// ─── Client ──────────────────────────────────────────────────────────────────

export class MemoryClient {
  private pool: Pool;
  private redis: RedisClientType;
  private redisSub: RedisClientType;
  private cfg: Required<Omit<MemoryClientConfig, 'onEmbed'>>;
  private onEmbed?: (durationSec: number, success: boolean) => void;
  private connected = false;

  constructor(config: MemoryClientConfig) {
    this.cfg = {
      ollamaUrl:            config.ollamaUrl          ?? 'http://localhost:11434',
      embeddingModel:       config.embeddingModel      ?? 'nomic-embed-text',
      agentId:              config.agentId             ?? 'main',
      bootstrapTtlSeconds:  config.bootstrapTtlSeconds ?? 300,
      pgUrl:                config.pgUrl,
      redisUrl:             config.redisUrl,
    };
    this.onEmbed = config.onEmbed;
    this.pool    = new Pool({ connectionString: config.pgUrl });
    this.redis   = createClient({ url: config.redisUrl }) as RedisClientType;
    this.redisSub = this.redis.duplicate() as RedisClientType;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.redis.on('error', (e: Error) => console.error('[memory:redis]', e.message));
    await this.redis.connect();
    await this.redisSub.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.redis.quit();
    await this.redisSub.quit();
    await this.pool.end();
    this.connected = false;
  }

  async ping(): Promise<{ pg: boolean; redis: boolean }> {
    const [pgOk, redisOk] = await Promise.all([
      this.pool.query('SELECT 1').then(() => true).catch(() => false),
      this.redis.ping().then(r => r === 'PONG').catch(() => false),
    ]);
    return { pg: pgOk, redis: redisOk };
  }

  // ─── Embedding ─────────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[] | null> {
    const textSlice = text.slice(0, 4000);
    const hash      = createHash('sha256').update(textSlice).digest('hex').slice(0, 32);
    const cacheKey  = `embed:${this.cfg.embeddingModel}:${hash}`;
    const start     = performance.now();

    // Redis cache check — embedding is deterministic: same model + text = same vector
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) {
        this.onEmbed?.((performance.now() - start) / 1000, true, true);
        return JSON.parse(hit) as number[];
      }
    } catch { /* cache unavailable — fall through to Ollama */ }

    // Ollama call
    try {
      const res = await fetch(`${this.cfg.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.cfg.embeddingModel, prompt: textSlice }),
      });
      if (!res.ok) {
        this.onEmbed?.((performance.now() - start) / 1000, false, false);
        return null;
      }
      const data   = await res.json() as { embedding: number[] };
      const vector = data.embedding;

      // Store in Redis — fire and forget, 24h TTL
      this.redis.set(cacheKey, JSON.stringify(vector), { EX: 86400 }).catch(() => {});

      this.onEmbed?.((performance.now() - start) / 1000, true, false);
      return vector;
    } catch {
      this.onEmbed?.((performance.now() - start) / 1000, false, false);
      return null;
    }
  }

  /** Check if the bootstrap cache key exists in Redis (without fetching content). */
  async isBootstrapCached(agentId = this.cfg.agentId): Promise<boolean> {
    return (await this.redis.exists(`bootstrap:${agentId}`)) === 1;
  }

  /** pg connection pool utilization stats. */
  poolStats(): PoolStats {
    return {
      total:   this.pool.totalCount,
      idle:    this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  private embeddingVal(v: number[] | null): string | null {
    return v ? `[${v.join(',')}]` : null;
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * Cold-start context for a new agent session.
   * Returns curated + memory-md chunks. Redis-cached for bootstrapTtlSeconds.
   */
  async bootstrap(agentId = this.cfg.agentId): Promise<MemoryChunk[]> {
    const cacheKey = `bootstrap:${agentId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as MemoryChunk[];

    const result = await this.pool.query<MemoryChunk>(`
      SELECT id, content, source_path as "sourcePath", source_type as "sourceType",
             memory_type as "memoryType", tags, agent_id as "agentId",
             visibility, decay_class as "decayClass", created_at as "createdAt"
      FROM memory_chunks
      WHERE visibility = 'shared'
        AND (tags && ARRAY['curated','memory-md']::text[]
             OR agent_id = $1)
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `, [agentId]);

    const chunks = result.rows;
    await this.redis.set(cacheKey, JSON.stringify(chunks), { EX: this.cfg.bootstrapTtlSeconds });
    return chunks;
  }

  private async invalidateBootstrap(agentId?: string): Promise<void> {
    if (agentId) {
      await this.redis.del(`bootstrap:${agentId}`);
    } else {
      // Invalidate all bootstrap caches
      const keys = await this.redis.keys('bootstrap:*');
      if (keys.length) await this.redis.del(keys);
    }
    await this.redis.publish(CHANNELS.MEMORY_BOOTSTRAP, JSON.stringify({ agentId, ts: Date.now() }));
  }

  // ─── Memory Read ───────────────────────────────────────────────────────────

  /**
   * Semantic + optional FTS hybrid search.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<MemoryChunk[]> {
    const {
      limit = 10,
      memoryType,
      tags,
      minSimilarity = 0.5,
      mode = 'hybrid',
    } = opts;

    const embedding = await this.embed(query);
    const conditions: string[] = ["visibility = 'shared'", "(expires_at IS NULL OR expires_at > NOW())"];
    const params: unknown[] = [];

    if (memoryType) { params.push(memoryType); conditions.push(`memory_type = $${params.length}`); }
    if (tags?.length) { params.push(tags); conditions.push(`tags && $${params.length}::text[]`); }

    const where = conditions.join(' AND ');

    if (mode === 'fts' || !embedding) {
      params.push(query); params.push(limit);
      const rows = await this.pool.query<MemoryChunk>(`
        SELECT id, content, source_path as "sourcePath", source_type as "sourceType",
               memory_type as "memoryType", tags, agent_id as "agentId",
               visibility, decay_client as "decayClass", created_at as "createdAt",
               ts_rank(to_tsvector('english', content), plainto_tsquery('english', $${params.length - 1})) as similarity
        FROM memory_chunks
        WHERE ${where}
          AND to_tsvector('english', content) @@ plainto_tsquery('english', $${params.length - 1})
        ORDER BY similarity DESC
        LIMIT $${params.length}
      `, params);
      return rows.rows;
    }

    // Vector search
    params.push(`[${embedding.join(',')}]`); params.push(minSimilarity); params.push(limit);
    const embIdx = params.length - 2;
    const simIdx = params.length - 1;
    const limIdx = params.length;

    const rows = await this.pool.query<MemoryChunk & { similarity: number }>(`
      SELECT id, content, source_path as "sourcePath", source_type as "sourceType",
             memory_type as "memoryType", tags, agent_id as "agentId",
             visibility, decay_class as "decayClass", created_at as "createdAt",
             1 - (embedding <=> $${embIdx}::vector) AS similarity
      FROM memory_chunks
      WHERE ${where}
        AND 1 - (embedding <=> $${embIdx}::vector) >= $${simIdx}
      ORDER BY embedding <=> $${embIdx}::vector
      LIMIT $${limIdx}
    `, params);

    return rows.rows;
  }

  async getEntity(name: string): Promise<Entity | null> {
    const result = await this.pool.query<Entity>(`
      SELECT id, name, entity_type as "entityType", summary,
             metadata, created_at as "createdAt", updated_at as "updatedAt"
      FROM entities WHERE name = $1
    `, [name]);
    return result.rows[0] ?? null;
  }

  async getEntityChunks(entityName: string, limit = 20): Promise<MemoryChunk[]> {
    const result = await this.pool.query<MemoryChunk>(`
      SELECT mc.id, mc.content, mc.source_path as "sourcePath",
             mc.source_type as "sourceType", mc.memory_type as "memoryType",
             mc.tags, mc.agent_id as "agentId", mc.visibility,
             mc.decay_class as "decayClass", mc.created_at as "createdAt",
             cer.relationship
      FROM memory_chunks mc
      JOIN chunk_entity_refs cer ON mc.id = cer.chunk_id
      JOIN entities e ON cer.entity_id = e.id
      WHERE e.name = $1
      ORDER BY mc.created_at DESC
      LIMIT $2
    `, [entityName, limit]);
    return result.rows;
  }

  // ─── Memory Write ──────────────────────────────────────────────────────────

  async remember(content: string, opts: WriteMemoryOptions = {}): Promise<string> {
    const embedding = await this.embed(content);
    const result = await this.pool.query<{ id: string }>(`
      INSERT INTO memory_chunks
        (content, embedding, source_type, source_path, memory_type,
         tags, agent_id, visibility, decay_class, expires_at, session_id)
      VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      content,
      this.embeddingVal(embedding),
      opts.sourceType  ?? 'agent',
      opts.sourcePath  ?? null,
      opts.memoryType  ?? 'semantic',
      opts.tags        ?? [],
      this.cfg.agentId,
      opts.visibility  ?? 'shared',
      opts.decayClass  ?? 'standard',
      opts.expiresAt   ?? null,
      opts.sessionId   ?? null,
    ]);

    const id = result.rows[0].id;

    // Invalidate bootstrap if this is curated content
    const isCurated = opts.tags?.some(t => ['curated', 'memory-md'].includes(t));
    if (isCurated) await this.invalidateBootstrap();

    // Notify other agents
    await this.redis.publish(CHANNELS.MEMORY_NEW, JSON.stringify({
      id, agentId: this.cfg.agentId, tags: opts.tags, ts: Date.now(),
      preview: content.slice(0, 100),
    }));

    return id;
  }

  // ─── Command Log ───────────────────────────────────────────────────────────

  async logCommand(cmd: CommandEntry): Promise<void> {
    const embedText = [cmd.commandText, cmd.description, cmd.reasoning].filter(Boolean).join(' ');
    const embedding = await this.embed(embedText);

    await this.pool.query(`
      INSERT INTO command_log
        (agent_id, session_id, machine_id, project_path, git_branch, ts,
         tool_name, command_text, description, user_prompt, reasoning,
         outcome, result_text, exit_code, embedding)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector)
    `, [
      cmd.agentId      ?? this.cfg.agentId,
      cmd.sessionId,
      cmd.machineId    ?? null,
      cmd.projectPath  ?? null,
      cmd.gitBranch    ?? null,
      cmd.ts,
      cmd.toolName,
      cmd.commandText,
      cmd.description  ?? null,
      cmd.userPrompt   ?? null,
      cmd.reasoning    ?? null,
      cmd.outcome      ?? 'unknown',
      cmd.resultText   ?? null,
      cmd.exitCode     ?? null,
      this.embeddingVal(embedding),
    ]);

    await this.redis.publish(CHANNELS.COMMAND_RAN, JSON.stringify({
      agentId: cmd.agentId ?? this.cfg.agentId,
      toolName: cmd.toolName,
      description: cmd.description,
      outcome: cmd.outcome,
      ts: Date.now(),
    }));
  }

  async findPatterns(opts: { minCount?: number; toolName?: string; days?: number } = {}): Promise<PatternResult[]> {
    const { minCount = 3, toolName, days = 30 } = opts;
    const params: unknown[] = [days, minCount];
    let toolFilter = '';
    if (toolName) { params.push(toolName); toolFilter = `AND tool_name = $${params.length}`; }

    const result = await this.pool.query<PatternResult>(`
      SELECT tool_name as "toolName", command_text as "commandText",
             COUNT(*) as count, MAX(ts) as "lastRun",
             ROUND(AVG(duration_ms)) as "avgDurationMs",
             ROUND(AVG(CASE WHEN outcome = 'error' THEN 1.0 ELSE 0.0 END) * 100) as "errorRate"
      FROM command_log
      WHERE ts > NOW() - ($1 * INTERVAL '1 day') ${toolFilter}
      GROUP BY tool_name, command_text
      HAVING COUNT(*) >= $2
      ORDER BY count DESC
    `, params);
    return result.rows;
  }

  async searchCommands(query: string, limit = 20): Promise<CommandEntry[]> {
    const embedding = await this.embed(query);
    if (!embedding) return [];

    const result = await this.pool.query<CommandEntry>(`
      SELECT agent_id as "agentId", session_id as "sessionId",
             machine_id as "machineId", project_path as "projectPath",
             git_branch as "gitBranch", ts, tool_name as "toolName",
             command_text as "commandText", description, user_prompt as "userPrompt",
             reasoning, outcome, result_text as "resultText", exit_code as "exitCode",
             1 - (embedding <=> $1::vector) as similarity
      FROM command_log
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `, [`[${embedding.join(',')}]`, limit]);
    return result.rows;
  }

  // ─── Session Scratchpad (Redis) ────────────────────────────────────────────

  async setSessionState(sessionId: string, state: Record<string, unknown>, ttlSeconds = 86400): Promise<void> {
    await this.redis.hSet(`session:${sessionId}`, Object.fromEntries(
      Object.entries(state).map(([k, v]) => [k, JSON.stringify(v)])
    ));
    await this.redis.expire(`session:${sessionId}`, ttlSeconds);
  }

  async getSessionState(sessionId: string): Promise<Record<string, unknown>> {
    const raw = await this.redis.hGetAll(`session:${sessionId}`);
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v)]));
  }

  // ─── Pub/Sub ───────────────────────────────────────────────────────────────

  on(event: 'memory:new' | 'memory:bootstrap-invalidated' | 'memory:command-ran',
     callback: (data: unknown) => void): void {
    this.redisSub.subscribe(event, (msg: string) => {
      try { callback(JSON.parse(msg)); } catch { /* ignore */ }
    });
  }

  off(event: string): void {
    this.redisSub.unsubscribe(event);
  }
}
