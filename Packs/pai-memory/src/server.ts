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
import { MemoryClient } from './client';
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

const app = new Hono();

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY     = process.env.MEMORY_API_KEY;
const PUBLIC_PATHS = ['/health', '/ready', '/metrics'];

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
  }
  return _mem;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use('*', cors());
app.use('*', logger());

// Auth — skip public paths
app.use('*', async (c, next) => {
  if (PUBLIC_PATHS.includes(c.req.path)) return next();

  if (!API_KEY) {
    console.warn('WARNING: MEMORY_API_KEY not set — running without authentication');
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  if (authHeader.substring(7) !== API_KEY) {
    return c.json({ error: 'Invalid API key' }, 401);
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
  const agentId = c.req.query('agent') ?? AGENT_ID;
  const mem = await getMem();

  // Check cache BEFORE calling bootstrap so we can accurately track hit/miss
  const cacheHit = await mem.isBootstrapCached(agentId);

  const start = performance.now();
  const chunks = await mem.bootstrap(agentId);
  operationDuration.labels('bootstrap').observe((performance.now() - start) / 1000);

  if (cacheHit) bootstrapCacheHits.inc();
  else          bootstrapCacheMisses.inc();

  return c.json({ agentId, chunks, count: chunks.length, cacheHit });
});

// ─── Memory Search ────────────────────────────────────────────────────────────

app.post('/search', async (c) => {
  const body = await c.req.json();
  const { query, limit, memoryType, tags, mode, minSimilarity } = body;
  if (!query) return c.json({ error: 'query is required' }, 400);

  const mem = await getMem();
  const resolvedMode = mode ?? 'hybrid';
  searchRequestTotal.labels(resolvedMode).inc();

  const start = performance.now();
  const results = await mem.search(query, { limit, memoryType, tags, mode: resolvedMode, minSimilarity });
  operationDuration.labels('search').observe((performance.now() - start) / 1000);

  return c.json({ results, count: results.length, query });
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
  const body = await c.req.json();
  const { content, ...opts } = body;
  if (!content) return c.json({ error: 'content is required' }, 400);

  const mem = await getMem();
  const start = performance.now();
  const id = await mem.remember(content, opts);
  operationDuration.labels('remember').observe((performance.now() - start) / 1000);

  return c.json({ id, status: 'saved' }, 201);
});

// ─── Command Log ─────────────────────────────────────────────────────────────

app.post('/commands', async (c) => {
  const body = await c.req.json();
  if (!body.toolName)    return c.json({ error: 'toolName is required' }, 400);
  if (!body.commandText) return c.json({ error: 'commandText is required' }, 400);
  if (!body.ts)          body.ts = new Date().toISOString();

  const mem = await getMem();
  await mem.logCommand(body);
  return c.json({ status: 'logged' }, 201);
});

app.post('/commands/search', async (c) => {
  const { query, limit } = await c.req.json();
  if (!query) return c.json({ error: 'query is required' }, 400);

  const mem = await getMem();
  const start = performance.now();
  const results = await mem.searchCommands(query, limit ?? 20);
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

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get('/stats', async (c) => {
  const mem = await getMem();
  const pg  = (mem as unknown as { pool: { query: (s: string) => Promise<{ rows: Array<{ count: string }> }> } }).pool;

  const [chunks, entities, commands, ping, pool] = await Promise.all([
    pg.query('SELECT COUNT(*) AS count FROM memory_chunks'),
    pg.query('SELECT COUNT(*) AS count FROM entities'),
    pg.query('SELECT COUNT(*) AS count FROM command_log'),
    mem.ping(),
    Promise.resolve(mem.poolStats()),
  ]);

  return c.json({
    chunks:   parseInt(chunks.rows[0].count),
    entities: parseInt(entities.rows[0].count),
    commands: parseInt(commands.rows[0].count),
    backends: ping,
    pool,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '3000');

console.log(`PAI Memory API starting on port ${port}...`);
console.log(`pgvector: ${PG_URL.replace(/:([^@]+)@/, ':***@')}`);
console.log(`redis:    ${REDIS_URL}`);
console.log(`ollama:   ${OLLAMA_URL}`);

export default { port, fetch: app.fetch };
