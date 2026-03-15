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
  MemoryChunk, WriteMemoryOptions, UpdateMemoryOptions, SearchOptions,
  Entity, CommandEntry, PatternResult, MemoryClientConfig, PoolStats,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANNELS = {
  MEMORY_NEW:        'memory:new',
  MEMORY_BOOTSTRAP:  'memory:bootstrap-invalidated',
  COMMAND_RAN:       'memory:command-ran',
} as const;

export class EmbeddingUnavailableError extends Error {
  constructor(message = 'Embedding backend unavailable') {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class MemoryClient {
  private pool: Pool;
  private redis: RedisClientType;
  private redisSub: RedisClientType;
  private cfg: Required<Omit<MemoryClientConfig, 'onEmbed' | 'userId' | 'tenantIds'>> & { userId?: string; tenantIds: string[] };
  private onEmbed?: (durationSec: number, success: boolean, cached: boolean) => void;
  private connected = false;

  constructor(config: MemoryClientConfig) {
    this.cfg = {
      ollamaUrl:            config.ollamaUrl          ?? 'http://localhost:11434',
      embeddingModel:       config.embeddingModel      ?? 'nomic-embed-text',
      agentId:              config.agentId             ?? 'main',
      bootstrapTtlSeconds:  config.bootstrapTtlSeconds ?? 300,
      pgUrl:                config.pgUrl,
      redisUrl:             config.redisUrl,
      userId:               config.userId             ?? undefined,
      tenantIds:            config.tenantIds          ?? [],
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

  private extractEmbeddingVector(data: unknown): number[] | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as { embedding?: unknown; embeddings?: unknown };

    // /api/embeddings shape: { embedding: number[] }
    if (Array.isArray(d.embedding) && d.embedding.every(n => typeof n === 'number')) {
      return d.embedding as number[];
    }

    // /api/embed shape: { embeddings: number[][] }
    if (Array.isArray(d.embeddings) && Array.isArray(d.embeddings[0])) {
      const first = d.embeddings[0];
      if (Array.isArray(first) && first.every(n => typeof n === 'number')) return first as number[];
    }

    return null;
  }

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

    // Ollama call (support both /api/embeddings and /api/embed payload formats).
    const attempts: Array<{ path: string; body: Record<string, unknown> }> = [
      { path: '/api/embeddings', body: { model: this.cfg.embeddingModel, prompt: textSlice } },
      { path: '/api/embed', body: { model: this.cfg.embeddingModel, input: textSlice } },
    ];

    let lastError = 'no attempts made';
    for (const attempt of attempts) {
      try {
        const res = await fetch(`${this.cfg.ollamaUrl}${attempt.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt.body),
          signal: AbortSignal.timeout(6000),
        });

        if (!res.ok) {
          const body = (await res.text().catch(() => '')).slice(0, 200);
          lastError = `${attempt.path} HTTP ${res.status}${body ? `: ${body}` : ''}`;
          continue;
        }

        const data = await res.json() as unknown;
        const vector = this.extractEmbeddingVector(data);
        if (!vector || vector.length === 0) {
          lastError = `${attempt.path} returned no embedding vector`;
          continue;
        }

        // Store in Redis — fire and forget, 24h TTL
        this.redis.set(cacheKey, JSON.stringify(vector), { EX: 86400 }).catch(() => {});

        this.onEmbed?.((performance.now() - start) / 1000, true, false);
        return vector;
      } catch (err) {
        lastError = `${attempt.path} ${(err as Error)?.message ?? String(err)}`;
      }
    }

    console.error(`[memory:embed] failed model=${this.cfg.embeddingModel} ollama=${this.cfg.ollamaUrl} err=${lastError}`);
    this.onEmbed?.((performance.now() - start) / 1000, false, false);
    return null;
  }

  /** Check if the bootstrap cache key exists in Redis (without fetching content). */
  async isBootstrapCached(agentOrUserId = this.cfg.agentId): Promise<boolean> {
    // Check both key patterns
    const agentHit = await this.redis.exists(`bootstrap:${agentOrUserId}`);
    if (agentHit === 1) return true;
    const userHit = await this.redis.exists(`bootstrap:user:${agentOrUserId}`);
    return userHit === 1;
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

  /**
   * Multi-tenant bootstrap: returns org + personal memories for a user.
   * Org memories first, then personal. Redis-cached by userId.
   */
  async bootstrapMultiTenant(userId: string, tenantIds?: string[]): Promise<MemoryChunk[]> {
    const effectiveTenantIds = tenantIds ?? this.cfg.tenantIds;
    if (!effectiveTenantIds.length) return this.bootstrap(); // fallback

    const cacheKey = `bootstrap:user:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as MemoryChunk[];

    const result = await this.pool.query<MemoryChunk>(`
      SELECT mc.id, mc.content, mc.source_path as "sourcePath",
             mc.source_type as "sourceType", mc.memory_type as "memoryType",
             mc.tags, mc.agent_id as "agentId", mc.visibility,
             mc.decay_class as "decayClass", mc.created_at as "createdAt",
             mc.tenant_id as "tenantId", mc.author_id as "authorId", mc.scope,
             t.type as "tenantType", t.slug as "tenantSlug"
      FROM memory_chunks mc
      JOIN tenants t ON mc.tenant_id = t.id
      WHERE mc.tenant_id = ANY($1::uuid[])
        AND (mc.tags && ARRAY['curated','memory-md']::text[])
        AND (mc.scope = 'org' OR (mc.scope = 'personal' AND mc.author_id = $2::uuid))
        AND (mc.expires_at IS NULL OR mc.expires_at > NOW())
      ORDER BY
        CASE t.type WHEN 'organization' THEN 0 ELSE 1 END,
        mc.created_at DESC
    `, [effectiveTenantIds, userId]);

    const chunks = result.rows;
    await this.redis.set(cacheKey, JSON.stringify(chunks), { EX: this.cfg.bootstrapTtlSeconds });
    return chunks;
  }

  private async invalidateBootstrap(agentId?: string): Promise<void> {
    if (agentId) {
      await this.redis.del(`bootstrap:${agentId}`);
    } else {
      // Invalidate all bootstrap caches (both agent-keyed and user-keyed)
      const agentKeys = await this.redis.keys('bootstrap:*');
      if (agentKeys.length) await this.redis.del(agentKeys);
    }
    await this.redis.publish(CHANNELS.MEMORY_BOOTSTRAP, JSON.stringify({ agentId, ts: Date.now() }));
  }

  // ─── Memory Read ───────────────────────────────────────────────────────────

  /** Fetch a single chunk by ID. */
  async get(id: string): Promise<MemoryChunk | null> {
    const result = await this.pool.query<MemoryChunk>(`
      SELECT id, content, source_path as "sourcePath", source_type as "sourceType",
             memory_type as "memoryType", tags, agent_id as "agentId",
             visibility, decay_class as "decayClass", created_at as "createdAt",
             tenant_id as "tenantId", author_id as "authorId", scope
      FROM memory_chunks WHERE id = $1
    `, [id]);
    return result.rows[0] ?? null;
  }

  /** List memory chunks with filtering and pagination. */
  async listChunks(opts: {
    tenant_ids?: string[];
    offset?: number;
    limit?: number;
    source?: string;
    tags?: string[];
    memory_type?: string;
  }): Promise<{ chunks: MemoryChunk[]; total: number }> {
    let sql = 'SELECT * FROM memory_chunks WHERE 1=1';
    let countSql = 'SELECT count(*)::int as total FROM memory_chunks WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (opts.tenant_ids?.length) {
      idx++;
      const clause = ` AND tenant_id = ANY($${idx})`;
      sql += clause;
      countSql += clause;
      params.push(opts.tenant_ids);
    }
    if (opts.tags?.length) {
      idx++;
      const clause = ` AND tags && $${idx}`;
      sql += clause;
      countSql += clause;
      params.push(opts.tags);
    }
    if (opts.memory_type) {
      idx++;
      const clause = ` AND memory_type = $${idx}`;
      sql += clause;
      countSql += clause;
      params.push(opts.memory_type);
    }
    if (opts.source) {
      idx++;
      const clause = ` AND source_path = $${idx}`;
      sql += clause;
      countSql += clause;
      params.push(opts.source);
    }

    sql += ' ORDER BY created_at DESC';

    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(sql, params),
      this.pool.query(countSql, params),
    ]);

    return { chunks: dataResult.rows, total: countResult.rows[0]?.total ?? 0 };
  }

  /** Delete memory chunks by ID. Returns number deleted. */
  async deleteChunks(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query('DELETE FROM memory_chunks WHERE id = ANY($1)', [ids]);
    return result.rowCount ?? 0;
  }

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
      tenantIds: optTenantIds,
      scopes,
      userId: optUserId,
    } = opts;

    const embedding = await this.embed(query);
    const conditions: string[] = ["(expires_at IS NULL OR expires_at > NOW())"];
    const params: unknown[] = [];

    // Tenant isolation
    const effectiveTenantIds = optTenantIds ?? this.cfg.tenantIds;
    const effectiveUserId = optUserId ?? this.cfg.userId;

    if (effectiveTenantIds.length > 0) {
      params.push(effectiveTenantIds);
      conditions.push(`tenant_id = ANY($${params.length}::uuid[])`);
      // Personal scope: only visible to author
      if (effectiveUserId) {
        params.push(effectiveUserId);
        conditions.push(`(scope != 'personal' OR author_id = $${params.length}::uuid)`);
      }
    } else {
      // Backward compat: no tenants → use old visibility filter
      conditions.push("visibility = 'shared'");
    }

    // Scope filter
    if (scopes?.length) {
      params.push(scopes);
      conditions.push(`scope = ANY($${params.length}::text[])`);
    }

    if (memoryType) { params.push(memoryType); conditions.push(`memory_type = $${params.length}`); }
    if (tags?.length) { params.push(tags); conditions.push(`tags && $${params.length}::text[]`); }

    const where = conditions.join(' AND ');

    if (mode === 'fts' || !embedding) {
      params.push(query); params.push(limit);
      const rows = await this.pool.query<MemoryChunk>(`
        SELECT id, content, source_path as "sourcePath", source_type as "sourceType",
               memory_type as "memoryType", tags, agent_id as "agentId",
               visibility, decay_class as "decayClass", created_at as "createdAt",
               tenant_id as "tenantId", author_id as "authorId", scope,
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
             tenant_id as "tenantId", author_id as "authorId", scope,
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
    if (!embedding) {
      throw new EmbeddingUnavailableError('Embedding backend unavailable: unable to generate vector for memory write');
    }
    const result = await this.pool.query<{ id: string }>(`
      INSERT INTO memory_chunks
        (content, embedding, source_type, source_path, memory_type,
         tags, agent_id, visibility, decay_class, expires_at, session_id,
         tenant_id, author_id, scope)
      VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      opts.tenantId    ?? this.cfg.tenantIds[0] ?? null,
      this.cfg.userId  ?? null,
      opts.scope       ?? 'org',
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

  /**
   * Update an existing memory chunk. Re-embeds if content changes.
   * Returns true if the chunk existed and was updated.
   */
  async update(id: string, opts: UpdateMemoryOptions): Promise<boolean> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id];

    if (opts.content !== undefined) {
      const embedding = await this.embed(opts.content);
      params.push(opts.content);
      sets.push(`content = $${params.length}`);
      params.push(this.embeddingVal(embedding));
      sets.push(`embedding = $${params.length}::vector`);
    }
    if (opts.tags !== undefined)       { params.push(opts.tags);       sets.push(`tags = $${params.length}`); }
    if (opts.sourcePath !== undefined)  { params.push(opts.sourcePath);  sets.push(`source_path = $${params.length}`); }
    if (opts.sourceType !== undefined)  { params.push(opts.sourceType);  sets.push(`source_type = $${params.length}`); }
    if (opts.memoryType !== undefined)  { params.push(opts.memoryType);  sets.push(`memory_type = $${params.length}`); }
    if (opts.visibility !== undefined)  { params.push(opts.visibility);  sets.push(`visibility = $${params.length}`); }
    if (opts.decayClass !== undefined)  { params.push(opts.decayClass);  sets.push(`decay_class = $${params.length}`); }
    if (opts.expiresAt !== undefined)   { params.push(opts.expiresAt);   sets.push(`expires_at = $${params.length}`); }

    const result = await this.pool.query(
      `UPDATE memory_chunks SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );

    const updated = (result.rowCount ?? 0) > 0;
    if (updated) await this.invalidateBootstrap();
    return updated;
  }

  /**
   * Delete a memory chunk by ID. Cascades to chunk_entity_refs.
   * Returns true if the chunk existed and was deleted.
   */
  async forget(id: string): Promise<boolean> {
    const existing = await this.get(id);
    const result = await this.pool.query(`DELETE FROM memory_chunks WHERE id = $1`, [id]);
    const deleted = (result.rowCount ?? 0) > 0;

    if (deleted && existing?.tags?.some(t => ['curated', 'memory-md'].includes(t))) {
      await this.invalidateBootstrap();
    }
    return deleted;
  }

  /**
   * Promote a personal memory to an organization tenant.
   * Copies the chunk (doesn't move it). Returns the new chunk's ID.
   */
  async promote(chunkId: string, toTenantId: string, userId: string): Promise<string> {
    const source = await this.get(chunkId);
    if (!source) throw new Error(`Chunk not found: ${chunkId}`);
    if (source.authorId !== userId) throw new Error('Only the author can promote a memory');
    if (source.scope !== 'personal') throw new Error('Only personal-scope memories can be promoted');

    const result = await this.pool.query<{ id: string }>(`
      INSERT INTO memory_chunks
        (content, embedding, source_type, source_path, memory_type,
         tags, agent_id, visibility, decay_class, expires_at, session_id,
         tenant_id, author_id, scope)
      SELECT content, embedding, 'promoted', 'promoted-from:' || id::text, memory_type,
             tags, agent_id, visibility, decay_class, expires_at, session_id,
             $1, author_id, 'org'
      FROM memory_chunks WHERE id = $2
      RETURNING id
    `, [toTenantId, chunkId]);

    const newId = result.rows[0].id;

    // Invalidate bootstrap if promoted chunk has curated tags
    if (source.tags?.some(t => ['curated', 'memory-md'].includes(t))) {
      await this.invalidateBootstrap();
    }

    return newId;
  }

  // ─── Command Log ───────────────────────────────────────────────────────────

  async logCommand(cmd: CommandEntry): Promise<void> {
    const embedText = [cmd.commandText, cmd.description, cmd.reasoning].filter(Boolean).join(' ');
    const embedding = await this.embed(embedText);

    await this.pool.query(`
      INSERT INTO command_log
        (agent_id, session_id, machine_id, project_path, git_branch, ts,
         tool_name, command_text, description, user_prompt, reasoning,
         outcome, result_text, exit_code, embedding, tenant_id, author_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector,$16,$17)
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
      cmd.tenantId     ?? this.cfg.tenantIds[0] ?? null,
      cmd.authorId     ?? this.cfg.userId ?? null,
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

  async searchCommands(query: string, limit = 20, tenantIds?: string[]): Promise<CommandEntry[]> {
    const embedding = await this.embed(query);
    if (!embedding) return [];

    const effectiveTenantIds = tenantIds ?? this.cfg.tenantIds;
    let tenantFilter = '';
    const params: unknown[] = [`[${embedding.join(',')}]`, limit];

    if (effectiveTenantIds.length > 0) {
      params.push(effectiveTenantIds);
      tenantFilter = `AND tenant_id = ANY($${params.length}::uuid[])`;
    }

    const result = await this.pool.query<CommandEntry>(`
      SELECT agent_id as "agentId", session_id as "sessionId",
             machine_id as "machineId", project_path as "projectPath",
             git_branch as "gitBranch", ts, tool_name as "toolName",
             command_text as "commandText", description, user_prompt as "userPrompt",
             reasoning, outcome, result_text as "resultText", exit_code as "exitCode",
             tenant_id as "tenantId", author_id as "authorId",
             1 - (embedding <=> $1::vector) as similarity
      FROM command_log
      WHERE embedding IS NOT NULL ${tenantFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `, params);
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
