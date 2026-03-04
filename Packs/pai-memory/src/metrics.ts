/**
 * Prometheus Metrics for PAI Memory API
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'pai_memory_' });

// ============ HTTP Request Metrics ============

export const httpRequestDuration = new Histogram({
  name: 'pai_memory_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'pai_memory_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const httpInFlight = new Gauge({
  name: 'pai_memory_http_requests_in_flight',
  help: 'HTTP requests currently being processed (saturation signal)',
  registers: [registry],
});

// ============ Ollama Embedding Metrics (primary SLI) ============

export const embedDuration = new Histogram({
  name: 'pai_memory_embed_duration_seconds',
  help: 'Time to generate text embeddings via Ollama (dominant latency contributor)',
  labelNames: ['status'],  // 'ok' | 'error'
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

// ============ pgvector Operation Metrics ============

export const operationDuration = new Histogram({
  name: 'pai_memory_operation_duration_seconds',
  help: 'End-to-end duration of memory client operations (includes embed + pgvector)',
  labelNames: ['operation'],  // 'search' | 'bootstrap' | 'remember' | 'entity_lookup' | 'command_search'
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const pgPoolWaiting = new Gauge({
  name: 'pai_memory_pg_pool_waiting',
  help: 'pg connection pool: requests waiting for a free connection (saturation signal)',
  registers: [registry],
});

export const pgPoolTotal = new Gauge({
  name: 'pai_memory_pg_pool_total',
  help: 'pg connection pool: total connections (idle + active)',
  registers: [registry],
});

// ============ Bootstrap Cache Metrics ============

export const bootstrapCacheHits = new Counter({
  name: 'pai_memory_bootstrap_cache_hits_total',
  help: 'Bootstrap context served from Redis cache',
  registers: [registry],
});

export const bootstrapCacheMisses = new Counter({
  name: 'pai_memory_bootstrap_cache_misses_total',
  help: 'Bootstrap context fetched from pgvector (cache miss)',
  registers: [registry],
});

export const bootstrapCacheKeys = new Gauge({
  name: 'pai_memory_bootstrap_cache_keys_total',
  help: 'Number of active bootstrap cache entries in Redis',
  registers: [registry],
});

// ============ Search Metrics ============

export const searchRequestTotal = new Counter({
  name: 'pai_memory_search_requests_total',
  help: 'Total semantic search requests by mode',
  labelNames: ['mode'],  // 'vector' | 'fts' | 'hybrid'
  registers: [registry],
});

// ============ Corpus State Gauges ============

export const chunkCount = new Gauge({
  name: 'pai_memory_chunks_total',
  help: 'Total memory chunks in pgvector',
  registers: [registry],
});

export const entityCount = new Gauge({
  name: 'pai_memory_entities_total',
  help: 'Total named entities in the entity graph',
  registers: [registry],
});

export const commandCount = new Gauge({
  name: 'pai_memory_commands_total',
  help: 'Total commands in the command log',
  registers: [registry],
});

// ============ Helper Functions ============

/**
 * Normalize route path for metrics labels.
 * e.g., "/entity/TinkerBelle/chunks" -> "/entity/:name/chunks"
 */
export function normalizeRoute(path: string): string {
  if (path.startsWith('/entity/')) {
    return path.endsWith('/chunks') ? '/entity/:name/chunks' : '/entity/:name';
  }
  if (path.startsWith('/session/')) return '/session/:id';
  if (path === '/commands/search') return '/commands/search';
  if (path === '/commands') return '/commands';
  if (path.startsWith('/search')) return '/search';
  return path;
}
