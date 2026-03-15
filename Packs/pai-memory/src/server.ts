/**
 * PAI Memory API Server
 *
 * HTTP wrapper over MemoryClient — exposes bootstrap context, semantic search,
 * entity graph, command log, and session scratchpad to remote agents.
 *
 * Agents without local pgvector access can call this instead of connecting
 * directly to the database.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './mcp-tools.js';
import { EmbeddingUnavailableError, MemoryClient } from './client';
import {
  registry,
  httpRequestDuration,
  httpRequestTotal,
  httpInFlight,
  embedDuration,
  operationDuration,
  pgPoolWaiting,
  pgPoolTotal,
  bootstrapCacheHits,
  bootstrapCacheMisses,
  bootstrapCacheKeys,
  searchRequestTotal,
  chunkCount,
  entityCount,
  commandCount,
  normalizeRoute,
} from './metrics';
import { authMiddleware, getTenantContext } from './auth';
import * as tenants from './tenants';
import type { TenantContext } from './types';
import { createSource, getSource, listSources, updateSource, deleteSource, createCredential, listCredentials, deleteCredential, testCredential, listSourceFiles } from './sources';
import { syncSource } from './sync-engine';
import { importMarkdownFiles, importJsonChunks, importClaudeMemory } from './import';
import { exportAsMarkdown, exportAsJson } from './export';

const app = new Hono();

// ─── Config ──────────────────────────────────────────────────────────────────

const PG_URL = process.env.PG_URL ?? (
  `postgresql://${process.env.POSTGRES_USER ?? 'memory'}` +
  `:${process.env.POSTGRES_PASSWORD ?? 'memory-ev-2026'}` +
  `@${process.env.POSTGRES_HOST ?? 'pgvector.memory.svc'}:5432/memory`
);
const REDIS_URL  = process.env.REDIS_URL  ?? 'redis://memory-redis.memory.svc:6379';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://ollama.ollama.svc:11434';
const AGENT_ID   = process.env.AGENT_ID   ?? 'memory-api';

// ─── MemoryClient (lazy singleton) ───────────────────────────────────────────

let _mem: MemoryClient | null = null;
let pool: any = null;       // pg Pool — set on first getMem() call
let redisClient: any = null; // Redis client — set on first getMem() call

async function getMem(): Promise<MemoryClient> {
  if (!_mem) {
    _mem = new MemoryClient({
      pgUrl: PG_URL,
      redisUrl: REDIS_URL,
      ollamaUrl: OLLAMA_URL,
      agentId: AGENT_ID,
      onEmbed: (durationSec, success, cached) => {
        const status = cached ? 'cached' : success ? 'ok' : 'error';
        embedDuration.labels(status).observe(durationSec);
      },
    });
    await _mem.connect();
    // Extract internal pool and redis for route handlers
    pool = (_mem as any).pool;
    redisClient = (_mem as any).redis;
  }
  return _mem;
}

/** Ensure MemoryClient is initialized and return pool + client refs. */
async function getResources() {
  const memoryClient = await getMem();
  return { pool, memoryClient, redisClient };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'],
  exposeHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
}));
app.use('*', logger());

// Auth (JWT → API key → dev mode)
app.use('*', authMiddleware);

// RLS context — set PostgreSQL session variable for row-level security
app.use('*', async (c, next) => {
  const ctx = getTenantContext(c);
  if (ctx?.userId) {
    const mem = await getMem();
    // Access pool through the client for RLS setup
    const pool = (mem as any).pool;
    await pool.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
  }
  return next();
});

// In-flight tracking + request timing
app.use('*', async (c, next) => {
  httpInFlight.inc();
  const start = performance.now();
  await next();
  const durationSec = (performance.now() - start) / 1000;
  httpInFlight.dec();

  const route  = normalizeRoute(c.req.path);
  const method = c.req.method;
  const status = String(c.res.status);
  httpRequestDuration.labels(method, route, status).observe(durationSec);
  httpRequestTotal.labels(method, route, status).inc();
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', async (c) => {
  try {
    const mem = await getMem();
    const status = await mem.ping();
    const ok = status.pg && status.redis;
    return c.json({ status: ok ? 'ok' : 'degraded', ...status }, ok ? 200 : 500);
  } catch (err) {
    return c.json({ status: 'error', error: String(err) }, 500);
  }
});

app.get('/ready', async (c) => {
  try {
    const mem = await getMem();
    const status = await mem.ping();
    if (status.pg && status.redis) return c.json({ ready: true });
    return c.json({ ready: false, ...status }, 503);
  } catch {
    return c.json({ ready: false }, 503);
  }
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

app.get('/metrics', async (c) => {
  try {
    const mem = await getMem();

    // Pool saturation
    const pool = mem.poolStats();
    pgPoolWaiting.set(pool.waiting);
    pgPoolTotal.set(pool.total);

    // Corpus gauges (direct SQL — fast queries)
    const pg = (mem as unknown as { pool: { query: (s: string) => Promise<{ rows: Array<{ count: string }> }> } }).pool;
    const [chunks, entities, commands] = await Promise.all([
      pg.query('SELECT COUNT(*) AS count FROM memory_chunks'),
      pg.query('SELECT COUNT(*) AS count FROM entities'),
      pg.query('SELECT COUNT(*) AS count FROM command_log'),
    ]);
    chunkCount.set(parseInt(chunks.rows[0].count));
    entityCount.set(parseInt(entities.rows[0].count));
    commandCount.set(parseInt(commands.rows[0].count));

    c.header('Content-Type', registry.contentType);
    return c.text(await registry.metrics());
  } catch (err) {
    console.error('Metrics error:', err);
    return c.text('# Error collecting metrics', 500);
  }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

app.get('/bootstrap', async (c) => {
  const ctx = getTenantContext(c);
  const mem = await getMem();

  const start = performance.now();
  let chunks;
  let cacheHit = false;

  if (ctx?.userId && ctx.tenantIds.length > 0) {
    // Multi-tenant bootstrap
    cacheHit = await mem.isBootstrapCached(ctx.userId);
    chunks = await mem.bootstrapMultiTenant(ctx.userId, ctx.tenantIds);
  } else {
    // Legacy bootstrap
    const agentId = c.req.query('agent') ?? AGENT_ID;
    cacheHit = await mem.isBootstrapCached(agentId);
    chunks = await mem.bootstrap(agentId);
  }

  operationDuration.labels('bootstrap').observe((performance.now() - start) / 1000);
  if (cacheHit) bootstrapCacheHits.inc();
  else bootstrapCacheMisses.inc();

  return c.json({ userId: ctx?.userId, chunks, count: chunks.length, cacheHit });
});

// ─── Memory Search ────────────────────────────────────────────────────────────

app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { query, limit, memoryType, tags, mode, minSimilarity, scopes } = body;
    if (!query) return c.json({ error: 'query is required' }, 400);

    const ctx = getTenantContext(c);
    const mem = await getMem();
    const resolvedMode = mode ?? 'hybrid';
    searchRequestTotal.labels(resolvedMode).inc();

    const start = performance.now();
    const results = await mem.search(query, {
      limit, memoryType, tags, mode: resolvedMode, minSimilarity,
      tenantIds: ctx?.tenantIds,
      scopes,
      userId: ctx?.userId,
    });
    operationDuration.labels('search').observe((performance.now() - start) / 1000);

    return c.json({ results, count: results.length, query });
  } catch (err) {
    console.error('[memory-api] /search failed:', err);
    return c.json({ error: 'Search failed' }, 500);
  }
});

// ─── Entity Graph ─────────────────────────────────────────────────────────────

app.get('/entity/:name', async (c) => {
  const name = c.req.param('name');
  const mem = await getMem();

  const start = performance.now();
  const entity = await mem.getEntity(name);
  operationDuration.labels('entity_lookup').observe((performance.now() - start) / 1000);

  if (!entity) return c.json({ error: `Entity not found: ${name}` }, 404);
  return c.json(entity);
});

app.get('/entity/:name/chunks', async (c) => {
  const name  = c.req.param('name');
  const limit = parseInt(c.req.query('limit') ?? '20');
  const mem = await getMem();

  const start = performance.now();
  const chunks = await mem.getEntityChunks(name, limit);
  operationDuration.labels('entity_lookup').observe((performance.now() - start) / 1000);

  return c.json({ entity: name, chunks, count: chunks.length });
});

// ─── Memory Write ─────────────────────────────────────────────────────────────

app.post('/remember', async (c) => {
  try {
    const body = await c.req.json();
    const { content, ...opts } = body;
    if (!content) return c.json({ error: 'content is required' }, 400);

    const ctx = getTenantContext(c);
    const mem = await getMem();

    // Set tenant context from JWT if not explicitly provided
    if (ctx && !opts.tenantId) {
      opts.tenantId = opts.tenantId ?? ctx.activeTenantId;
    }

    const start = performance.now();
    const id = await mem.remember(content, opts);
    operationDuration.labels('remember').observe((performance.now() - start) / 1000);

    return c.json({ id, status: 'saved' }, 201);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error('[memory-api] /remember failed:', message);

    // Dependency failure (Ollama/embed unavailable) should surface as service unavailable.
    if (err instanceof EmbeddingUnavailableError) {
      return c.json({ error: 'Embedding backend unavailable; memory was not written' }, 503);
    }
    return c.json({ error: 'Remember failed' }, 500);
  }
});

// ─── Memory CRUD ─────────────────────────────────────────────────────────

app.get('/chunk/:id', async (c) => {
  const id = c.req.param('id');
  const mem = await getMem();
  const chunk = await mem.get(id);
  if (!chunk) return c.json({ error: `Chunk not found: ${id}` }, 404);
  return c.json(chunk);
});

app.patch('/chunk/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const mem = await getMem();
  const start = performance.now();
  const updated = await mem.update(id, body);
  operationDuration.labels('update').observe((performance.now() - start) / 1000);

  if (!updated) return c.json({ error: `Chunk not found: ${id}` }, 404);
  return c.json({ id, status: 'updated' });
});

app.delete('/chunk/:id', async (c) => {
  const id = c.req.param('id');
  const mem = await getMem();

  const start = performance.now();
  const deleted = await mem.forget(id);
  operationDuration.labels('forget').observe((performance.now() - start) / 1000);

  if (!deleted) return c.json({ error: `Chunk not found: ${id}` }, 404);
  return c.json({ id, status: 'deleted' });
});

// ─── Command Log ─────────────────────────────────────────────────────────────

app.post('/commands', async (c) => {
  const body = await c.req.json();
  if (!body.toolName)    return c.json({ error: 'toolName is required' }, 400);
  if (!body.commandText) return c.json({ error: 'commandText is required' }, 400);
  if (!body.ts)          body.ts = new Date().toISOString();

  const ctx = getTenantContext(c);
  if (ctx) {
    body.tenantId = body.tenantId ?? ctx.activeTenantId;
    body.authorId = body.authorId ?? ctx.userId;
  }

  const mem = await getMem();
  await mem.logCommand(body);
  return c.json({ status: 'logged' }, 201);
});

app.post('/commands/search', async (c) => {
  const { query, limit } = await c.req.json();
  if (!query) return c.json({ error: 'query is required' }, 400);

  const ctx = getTenantContext(c);
  const mem = await getMem();
  const start = performance.now();
  const results = await mem.searchCommands(query, limit ?? 20, ctx?.tenantIds);
  operationDuration.labels('command_search').observe((performance.now() - start) / 1000);

  return c.json({ results, count: results.length, query });
});

app.get('/patterns', async (c) => {
  const minCount = parseInt(c.req.query('minCount') ?? '3');
  const days     = parseInt(c.req.query('days')     ?? '30');
  const toolName = c.req.query('toolName');

  const mem = await getMem();
  const patterns = await mem.findPatterns({ minCount, days, toolName });
  return c.json({ patterns, count: patterns.length });
});

// ─── Session Scratchpad ───────────────────────────────────────────────────────

app.get('/session/:id', async (c) => {
  const id  = c.req.param('id');
  const mem = await getMem();
  const state = await mem.getSessionState(id);
  return c.json({ id, state });
});

app.put('/session/:id', async (c) => {
  const id    = c.req.param('id');
  const state = await c.req.json();
  const ttl   = parseInt(c.req.query('ttl') ?? '604800');

  const mem = await getMem();
  await mem.setSessionState(id, state, ttl);
  return c.json({ id, status: 'saved' });
});

// ─── Promotion ──────────────────────────────────────────────────────────────

app.post('/promote', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required for promotion' }, 401);

  const { chunkId, toTenantId } = await c.req.json();
  if (!chunkId)    return c.json({ error: 'chunkId is required' }, 400);
  if (!toTenantId) return c.json({ error: 'toTenantId is required' }, 400);

  // Verify user is member of target tenant
  if (!ctx.tenantIds.includes(toTenantId)) {
    return c.json({ error: 'Not a member of target tenant' }, 403);
  }

  try {
    const mem = await getMem();
    const newId = await mem.promote(chunkId, toTenantId, ctx.userId);
    return c.json({ id: newId, status: 'promoted', fromChunkId: chunkId, toTenantId }, 201);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not found')) return c.json({ error: message }, 404);
    if (message.includes('Only')) return c.json({ error: message }, 403);
    return c.json({ error: 'Promotion failed' }, 500);
  }
});

// ─── Tenant Management ──────────────────────────────────────────────────────

app.get('/me', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const pool = ((await getMem()) as any).pool;
  const user = await tenants.getUser(pool, ctx.userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  const userTenants = await tenants.listTenants(pool, ctx.userId);
  return c.json({ user, tenants: userTenants });
});

app.get('/tenants', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const pool = ((await getMem()) as any).pool;
  const userTenants = await tenants.listTenants(pool, ctx.userId);
  return c.json({ tenants: userTenants, count: userTenants.length });
});

app.post('/tenants', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const { slug, name, settings } = await c.req.json();
  if (!slug) return c.json({ error: 'slug is required' }, 400);
  if (!name) return c.json({ error: 'name is required' }, 400);

  const pool = ((await getMem()) as any).pool;
  try {
    const tenant = await tenants.createTenant(pool, {
      slug, type: 'organization', name, settings,
    });
    // Auto-add creator as owner
    await tenants.addMember(pool, {
      tenantId: tenant.id, userId: ctx.userId, role: 'owner',
    });
    return c.json({ tenant, status: 'created' }, 201);
  } catch (err) {
    if ((err as Error).message.includes('unique') || (err as Error).message.includes('duplicate')) {
      return c.json({ error: `Tenant slug '${slug}' already exists` }, 409);
    }
    throw err;
  }
});

app.get('/tenants/:slug', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const slug = c.req.param('slug');
  const pool = ((await getMem()) as any).pool;
  const tenant = await tenants.getTenant(pool, slug);
  if (!tenant) return c.json({ error: `Tenant not found: ${slug}` }, 404);

  // Verify membership
  if (!ctx.tenantIds.includes(tenant.id)) {
    return c.json({ error: 'Not a member of this tenant' }, 403);
  }

  const members = await tenants.listMembers(pool, tenant.id);
  return c.json({ tenant, members });
});

app.patch('/tenants/:slug', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const slug = c.req.param('slug');
  const pool = ((await getMem()) as any).pool;
  const tenant = await tenants.getTenant(pool, slug);
  if (!tenant) return c.json({ error: `Tenant not found: ${slug}` }, 404);

  // Require admin or owner
  const role = await tenants.getMemberRole(pool, tenant.id, ctx.userId);
  if (!role || !['owner', 'admin'].includes(role)) {
    return c.json({ error: 'Requires admin or owner role' }, 403);
  }

  const { name, settings } = await c.req.json();
  await tenants.updateTenant(pool, tenant.id, { name, settings });
  return c.json({ status: 'updated' });
});

app.post('/tenants/:slug/members', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const slug = c.req.param('slug');
  const pool = ((await getMem()) as any).pool;
  const tenant = await tenants.getTenant(pool, slug);
  if (!tenant) return c.json({ error: `Tenant not found: ${slug}` }, 404);

  // Require admin or owner
  const role = await tenants.getMemberRole(pool, tenant.id, ctx.userId);
  if (!role || !['owner', 'admin'].includes(role)) {
    return c.json({ error: 'Requires admin or owner role' }, 403);
  }

  const { handle, role: memberRole } = await c.req.json();
  if (!handle) return c.json({ error: 'handle is required' }, 400);
  if (!memberRole) return c.json({ error: 'role is required' }, 400);

  const user = await tenants.getUser(pool, handle);
  if (!user) return c.json({ error: `User not found: ${handle}` }, 404);

  await tenants.addMember(pool, {
    tenantId: tenant.id, userId: user.id, role: memberRole,
  });
  return c.json({ status: 'added' });
});

app.delete('/tenants/:slug/members/:handle', async (c) => {
  const ctx = getTenantContext(c);
  if (!ctx) return c.json({ error: 'Authentication required' }, 401);

  const slug = c.req.param('slug');
  const handle = c.req.param('handle');
  const pool = ((await getMem()) as any).pool;
  const tenant = await tenants.getTenant(pool, slug);
  if (!tenant) return c.json({ error: `Tenant not found: ${slug}` }, 404);

  // Require admin or owner
  const role = await tenants.getMemberRole(pool, tenant.id, ctx.userId);
  if (!role || !['owner', 'admin'].includes(role)) {
    return c.json({ error: 'Requires admin or owner role' }, 403);
  }

  const user = await tenants.getUser(pool, handle);
  if (!user) return c.json({ error: `User not found: ${handle}` }, 404);

  try {
    await tenants.removeMember(pool, tenant.id, user.id);
    return c.json({ status: 'removed' });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get('/stats', async (c) => {
  const ctx = getTenantContext(c);
  const mem = await getMem();
  const pool = (mem as any).pool;

  let chunkQuery = 'SELECT COUNT(*) AS count FROM memory_chunks';
  let entityQuery = 'SELECT COUNT(*) AS count FROM entities';
  let commandQuery = 'SELECT COUNT(*) AS count FROM command_log';
  const params: unknown[] = [];

  if (ctx?.tenantIds?.length) {
    params.push(ctx.tenantIds);
    chunkQuery += ` WHERE tenant_id = ANY($1::uuid[])`;
    entityQuery += ` WHERE tenant_id = ANY($1::uuid[])`;
    commandQuery += ` WHERE tenant_id = ANY($1::uuid[])`;
  }

  const [chunks, ents, commands, ping, poolStats] = await Promise.all([
    pool.query(chunkQuery, params),
    pool.query(entityQuery, params),
    pool.query(commandQuery, params),
    mem.ping(),
    Promise.resolve(mem.poolStats()),
  ]);

  return c.json({
    chunks:   parseInt(chunks.rows[0].count),
    entities: parseInt(ents.rows[0].count),
    commands: parseInt(commands.rows[0].count),
    backends: ping,
    pool: poolStats,
  });
});

// ─── Sources ─────────────────────────────────────────────────────────────────

app.get('/sources', async (c) => {
  const ctx = getTenantContext(c);
  const tenantId = ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool } = await getResources();
  const sources = await listSources(pool, tenantId);
  return c.json(sources);
});

app.post('/sources', async (c) => {
  const ctx = getTenantContext(c);
  const body = await c.req.json();
  const tenantId = body.tenant_id || ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool } = await getResources();
  const source = await createSource(pool, { ...body, tenant_id: tenantId, created_by: ctx?.userId });
  return c.json(source, 201);
});

app.get('/sources/:id', async (c) => {
  const ctx = getTenantContext(c);
  const tenantId = ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool } = await getResources();
  const source = await getSource(pool, c.req.param('id'), tenantId);
  if (!source) return c.json({ error: 'Source not found' }, 404);
  return c.json(source);
});

app.patch('/sources/:id', async (c) => {
  const body = await c.req.json();
  const { pool } = await getResources();
  const ok = await updateSource(pool, c.req.param('id'), body);
  if (!ok) return c.json({ error: 'Source not found' }, 404);
  return c.json({ ok: true });
});

app.delete('/sources/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { pool } = await getResources();
  const ok = await deleteSource(pool, c.req.param('id'), body.deleteChunks);
  if (!ok) return c.json({ error: 'Source not found' }, 404);
  return c.json({ ok: true });
});

app.post('/sources/:id/sync', async (c) => {
  const ctx = getTenantContext(c);
  const tenantId = ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool, memoryClient, redisClient } = await getResources();
  const source = await getSource(pool, c.req.param('id'), tenantId);
  if (!source) return c.json({ error: 'Source not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const stats = await syncSource(pool, memoryClient, redisClient, source, { force: body.force });
  return c.json(stats);
});

app.get('/sources/:id/files', async (c) => {
  const { pool } = await getResources();
  const files = await listSourceFiles(pool, c.req.param('id'));
  return c.json(files);
});

// ─── Credentials ─────────────────────────────────────────────────────────────

app.get('/credentials', async (c) => {
  const ctx = getTenantContext(c);
  const tenantId = ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool } = await getResources();
  const creds = await listCredentials(pool, tenantId);
  return c.json(creds);
});

app.post('/credentials', async (c) => {
  const ctx = getTenantContext(c);
  const body = await c.req.json();
  const tenantId = body.tenant_id || ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool } = await getResources();
  const cred = await createCredential(pool, { ...body, tenant_id: tenantId, created_by: ctx?.userId });
  return c.json(cred, 201);
});

app.delete('/credentials/:id', async (c) => {
  const { pool } = await getResources();
  const ok = await deleteCredential(pool, c.req.param('id'));
  if (!ok) return c.json({ error: 'Credential not found' }, 404);
  return c.json({ ok: true });
});

app.post('/credentials/:id/test', async (c) => {
  const { pool } = await getResources();
  const result = await testCredential(pool, c.req.param('id'));
  return c.json(result);
});

// ─── Import ──────────────────────────────────────────────────────────────────

app.post('/import/json', async (c) => {
  const ctx = getTenantContext(c);
  const body = await c.req.json();
  const tenantId = body.options?.tenant_id || ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool, memoryClient } = await getResources();
  const result = await importJsonChunks(pool, memoryClient, body.chunks, { ...body.options, tenant_id: tenantId });
  return c.json(result);
});

app.post('/import/claude-memory', async (c) => {
  const ctx = getTenantContext(c);
  const body = await c.req.json();
  const tenantId = body.options?.tenant_id || ctx?.tenantIds?.[0];
  if (!tenantId) return c.json({ error: 'No tenant context' }, 401);
  const { pool, memoryClient } = await getResources();
  const result = await importClaudeMemory(pool, memoryClient, body.path, { ...body.options, tenant_id: tenantId });
  return c.json(result);
});

// ─── Export ──────────────────────────────────────────────────────────────────

app.post('/export/json', async (c) => {
  const { pool } = await getResources();
  const filter = await c.req.json();
  const result = await exportAsJson(pool, filter);
  return c.json(result);
});

// ─── UI Static Files ─────────────────────────────────────────────────────────

// Serve built UI assets
app.use('/ui/assets/*', serveStatic({ root: './ui/dist', rewriteRequestPath: (path) => path.replace(/^\/ui/, '') }));

// SPA fallback — serve index.html for all /ui/* routes
app.get('/ui', (c) => c.redirect('/ui/'));
app.get('/ui/*', async (c) => {
  try {
    const file = Bun.file('./ui/dist/index.html');
    if (await file.exists()) return c.html(await file.text());
  } catch {}
  return c.text('UI not built. Run: cd ui && bun run build', 404);
});

// ─── Remote MCP (Streamable HTTP) ────────────────────────────────────────────

app.all('/mcp', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';

  const transport = new WebStandardStreamableHTTPServerTransport();
  const mcpServer = createMcpServer(`http://localhost:${port}`, token);
  await mcpServer.connect(transport);

  const response = await transport.handleRequest(c.req.raw, {
    authInfo: { token, clientId: 'remote', scopes: [] },
  });

  return response;
});

// ─── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '3000');

console.log(`PAI Memory API starting on port ${port}...`);
console.log(`pgvector: ${PG_URL.replace(/:([^@]+)@/, ':***@')}`);
console.log(`redis:    ${REDIS_URL}`);
console.log(`ollama:   ${OLLAMA_URL}`);

export default { port, fetch: app.fetch };
