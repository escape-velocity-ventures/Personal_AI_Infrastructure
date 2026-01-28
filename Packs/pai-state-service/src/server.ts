/**
 * PAI State Service - HTTP Server
 *
 * REST API wrapping pai-redis for skills, memory, and sessions.
 * Stateless - Redis is the state.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bearerAuth } from 'hono/bearer-auth';
import { createClient, type RedisClientType } from 'redis';
import {
  registry,
  httpRequestDuration,
  httpRequestTotal,
  totalKeys,
  memoryUsedBytes,
  skillsCount,
  memoryEntriesCount,
  sessionsCount,
  parseMemoryToBytes,
  normalizeRoute,
} from './metrics';

const app = new Hono();

// Config
const API_KEY = process.env.PAI_STATE_API_KEY;
const PUBLIC_PATHS = ['/health', '/ready', '/metrics'];

// Middleware
app.use('*', cors());
app.use('*', logger());

// Auth middleware - skip for health checks
app.use('*', async (c, next) => {
  if (PUBLIC_PATHS.includes(c.req.path)) {
    return next();
  }

  if (!API_KEY) {
    console.warn('WARNING: PAI_STATE_API_KEY not set - running without authentication');
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7);
  if (token !== API_KEY) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  return next();
});

// Request timing middleware
app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  const duration = (performance.now() - start) / 1000; // Convert to seconds

  const route = normalizeRoute(c.req.path);
  const method = c.req.method;
  const status = String(c.res.status);

  httpRequestDuration.labels(method, route, status).observe(duration);
  httpRequestTotal.labels(method, route, status).inc();
});

// Redis client
let redis: RedisClientType;
const REDIS_URL = process.env.REDIS_URL || 'redis://pai-redis.pai.svc:6379';
const PREFIX = 'pai:';

async function getRedis(): Promise<RedisClientType> {
  if (!redis || !redis.isOpen) {
    redis = createClient({ url: REDIS_URL });
    redis.on('error', (err) => console.error('Redis error:', err));
    await redis.connect();
  }
  return redis;
}

// ============ Health ============

app.get('/health', async (c) => {
  try {
    const client = await getRedis();
    const pong = await client.ping();
    return c.json({ status: 'ok', redis: pong === 'PONG' });
  } catch (err) {
    return c.json({ status: 'error', error: String(err) }, 500);
  }
});

app.get('/ready', async (c) => {
  try {
    const client = await getRedis();
    await client.ping();
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

// ============ Metrics ============

app.get('/metrics', async (c) => {
  try {
    // Update gauge metrics from Redis before returning
    const client = await getRedis();

    const [dbSize, info, skillCount, memoryCount, sessionCount] = await Promise.all([
      client.dbSize(),
      client.info('memory'),
      client.sCard(`${PREFIX}index:skills`),
      client.keys(`${PREFIX}memory:*`).then(k => k.length),
      client.keys(`${PREFIX}session:*`).then(k => k.length),
    ]);

    // Parse memory info
    const usedMemoryMatch = info.match(/used_memory:(\d+)/);
    const usedMemory = usedMemoryMatch ? parseInt(usedMemoryMatch[1]) : 0;

    // Update gauges
    totalKeys.set(dbSize);
    memoryUsedBytes.set(usedMemory);
    skillsCount.set(skillCount);
    memoryEntriesCount.set(memoryCount);
    sessionsCount.set(sessionCount);

    // Return Prometheus format
    c.header('Content-Type', registry.contentType);
    return c.text(await registry.metrics());
  } catch (err) {
    console.error('Metrics error:', err);
    return c.text('# Error collecting metrics', 500);
  }
});

// ============ Skills ============

app.get('/skills', async (c) => {
  const client = await getRedis();

  // Get skill index or fall back to KEYS scan
  let skillKeys = await client.sMembers(`${PREFIX}index:skills`);

  if (skillKeys.length === 0) {
    // Fall back to scanning for SKILL.md files
    skillKeys = await client.keys(`${PREFIX}*SKILL.md`);
  }

  // Extract skill names from keys
  const skills = skillKeys.map(key => {
    // Key format: pai:pai:Releases:v2.3:.claude:skills:Browser:SKILL.md
    const parts = key.split(':');
    const skillIdx = parts.findIndex(p => p === 'skills');
    if (skillIdx !== -1 && parts[skillIdx + 1]) {
      return parts[skillIdx + 1];
    }
    return key;
  }).filter((v, i, a) => a.indexOf(v) === i); // unique

  return c.json({ skills, count: skills.length });
});

app.get('/skills/:name', async (c) => {
  const name = c.req.param('name');
  const client = await getRedis();

  // Find the skill key
  const keys = await client.keys(`${PREFIX}*skills:${name}:SKILL.md`);

  if (keys.length === 0) {
    return c.json({ error: `Skill '${name}' not found` }, 404);
  }

  const content = await client.get(keys[0]);

  // Also get related files for this skill
  const relatedKeys = await client.keys(`${PREFIX}*skills:${name}:*`);
  const files = relatedKeys.map(k => {
    const parts = k.split(':');
    const skillIdx = parts.findIndex(p => p === name);
    return parts.slice(skillIdx + 1).join('/');
  });

  return c.json({
    name,
    content,
    files,
    key: keys[0],
  });
});

app.get('/skills/:name/:path{.+}', async (c) => {
  const name = c.req.param('name');
  const path = c.req.param('path');
  const client = await getRedis();

  // Convert path to Redis key pattern
  const pathParts = path.split('/').join(':');
  const keys = await client.keys(`${PREFIX}*skills:${name}:${pathParts}`);

  if (keys.length === 0) {
    return c.json({ error: `File not found: ${name}/${path}` }, 404);
  }

  const content = await client.get(keys[0]);
  return c.json({ name, path, content, key: keys[0] });
});

// ============ Memory ============

app.get('/memory', async (c) => {
  const client = await getRedis();
  const keys = await client.keys(`${PREFIX}memory:*`);

  const entries = keys.map(k => k.replace(`${PREFIX}memory:`, '').replace(/:/g, '/'));

  return c.json({ entries, count: entries.length });
});

app.get('/memory/:path{.+}', async (c) => {
  const path = c.req.param('path');
  const client = await getRedis();

  // Convert path to Redis key
  const key = `${PREFIX}memory:${path.replace(/\//g, ':')}`;
  const stored = await client.get(key);

  if (stored === null) {
    return c.json({ error: `Memory entry not found: ${path}` }, 404);
  }

  // Try to parse as JSON (new format with mtime), fall back to raw content (old format)
  try {
    const parsed = JSON.parse(stored);
    if (parsed.content !== undefined) {
      return c.json({ path, content: parsed.content, mtime: parsed.mtime, key });
    }
  } catch {
    // Not JSON, treat as raw content (backwards compatibility)
  }

  return c.json({ path, content: stored, key });
});

app.put('/memory/:path{.+}', async (c) => {
  const path = c.req.param('path');
  const client = await getRedis();

  const body = await c.req.json();
  const content = body.content;
  const mtime = body.mtime;

  if (!content) {
    return c.json({ error: 'content field required' }, 400);
  }

  const key = `${PREFIX}memory:${path.replace(/\//g, ':')}`;

  // Store as JSON with content and optional mtime
  const stored = mtime ? JSON.stringify({ content, mtime }) : JSON.stringify({ content });
  await client.set(key, stored);

  return c.json({ path, key, status: 'saved' });
});

app.delete('/memory/:path{.+}', async (c) => {
  const path = c.req.param('path');
  const client = await getRedis();

  const key = `${PREFIX}memory:${path.replace(/\//g, ':')}`;
  const deleted = await client.del(key);

  return c.json({ path, key, deleted: deleted > 0 });
});

// ============ Sessions ============

app.get('/sessions', async (c) => {
  const client = await getRedis();
  const keys = await client.keys(`${PREFIX}session:*`);

  const sessions = keys.map(k => k.replace(`${PREFIX}session:`, ''));

  return c.json({ sessions, count: sessions.length });
});

app.get('/session/:id', async (c) => {
  const id = c.req.param('id');
  const client = await getRedis();

  const key = `${PREFIX}session:${id}`;
  const data = await client.get(key);

  if (!data) {
    return c.json({ error: `Session not found: ${id}` }, 404);
  }

  return c.json(JSON.parse(data));
});

app.put('/session/:id', async (c) => {
  const id = c.req.param('id');
  const client = await getRedis();

  const body = await c.req.json();
  const key = `${PREFIX}session:${id}`;

  // Merge with existing if present
  const existing = await client.get(key);
  const session = existing ? { ...JSON.parse(existing), ...body } : body;

  // Ensure timestamps
  session.id = id;
  session.updatedAt = new Date().toISOString();
  if (!session.createdAt) {
    session.createdAt = session.updatedAt;
  }

  await client.set(key, JSON.stringify(session), { EX: 86400 * 7 }); // 7 day TTL

  return c.json({ id, status: 'saved', session });
});

app.delete('/session/:id', async (c) => {
  const id = c.req.param('id');
  const client = await getRedis();

  const key = `${PREFIX}session:${id}`;
  const deleted = await client.del(key);

  return c.json({ id, deleted: deleted > 0 });
});

// ============ Generic Key-Value ============

app.get('/kv/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const client = await getRedis();

  const fullKey = `${PREFIX}${key}`;
  const value = await client.get(fullKey);

  if (value === null) {
    return c.json({ error: `Key not found: ${key}` }, 404);
  }

  // Try to parse as JSON, otherwise return raw
  try {
    return c.json({ key, value: JSON.parse(value) });
  } catch {
    return c.json({ key, value });
  }
});

app.put('/kv/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const client = await getRedis();

  const body = await c.req.json();
  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);
  const ttl = body.ttl; // optional TTL in seconds

  const fullKey = `${PREFIX}${key}`;

  if (ttl) {
    await client.set(fullKey, value, { EX: ttl });
  } else {
    await client.set(fullKey, value);
  }

  return c.json({ key, status: 'saved' });
});

// ============ Search ============

app.get('/search', async (c) => {
  const pattern = c.req.query('pattern') || '*';
  const client = await getRedis();

  const keys = await client.keys(`${PREFIX}${pattern}`);

  return c.json({ pattern, keys, count: keys.length });
});

// ============ Stats ============

app.get('/stats', async (c) => {
  const client = await getRedis();

  const [dbSize, info] = await Promise.all([
    client.dbSize(),
    client.info('memory'),
  ]);

  // Parse memory info
  const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';

  // Count by type
  const [skillCount, memoryCount, sessionCount] = await Promise.all([
    client.sCard(`${PREFIX}index:skills`),
    client.keys(`${PREFIX}memory:*`).then(k => k.length),
    client.keys(`${PREFIX}session:*`).then(k => k.length),
  ]);

  return c.json({
    totalKeys: dbSize,
    usedMemory,
    skills: skillCount,
    memoryEntries: memoryCount,
    sessions: sessionCount,
  });
});

// Start server
const port = parseInt(process.env.PORT || '3000');

console.log(`PAI State Service starting on port ${port}...`);
console.log(`Redis URL: ${REDIS_URL}`);

export default {
  port,
  fetch: app.fetch,
};
