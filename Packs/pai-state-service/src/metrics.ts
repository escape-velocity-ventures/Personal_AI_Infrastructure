/**
 * Prometheus Metrics for PAI State Service
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const registry = new Registry();

// Collect default metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register: registry, prefix: 'pai_state_' });

// ============ Request Metrics ============

export const httpRequestDuration = new Histogram({
  name: 'pai_state_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'pai_state_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

// ============ Redis Metrics ============

export const redisOperationDuration = new Histogram({
  name: 'pai_state_redis_operation_duration_seconds',
  help: 'Duration of Redis operations in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const redisOperationTotal = new Counter({
  name: 'pai_state_redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'status'],
  registers: [registry],
});

// ============ State Metrics (Gauges) ============

export const totalKeys = new Gauge({
  name: 'pai_state_redis_keys_total',
  help: 'Total number of keys in Redis',
  registers: [registry],
});

export const memoryUsedBytes = new Gauge({
  name: 'pai_state_redis_memory_used_bytes',
  help: 'Memory used by Redis in bytes',
  registers: [registry],
});

export const skillsCount = new Gauge({
  name: 'pai_state_skills_total',
  help: 'Number of skills stored',
  registers: [registry],
});

export const memoryEntriesCount = new Gauge({
  name: 'pai_state_memory_entries_total',
  help: 'Number of memory entries stored',
  registers: [registry],
});

export const sessionsCount = new Gauge({
  name: 'pai_state_sessions_total',
  help: 'Number of active sessions',
  registers: [registry],
});

// ============ Helper Functions ============

/**
 * Parse Redis memory string to bytes
 * e.g., "10.76M" -> 11283251
 */
export function parseMemoryToBytes(memStr: string): number {
  const match = memStr.match(/^([\d.]+)([KMGT]?)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: Record<string, number> = {
    '': 1,
    'K': 1024,
    'M': 1024 * 1024,
    'G': 1024 * 1024 * 1024,
    'T': 1024 * 1024 * 1024 * 1024,
  };

  return Math.round(value * (multipliers[unit] || 1));
}

/**
 * Normalize route path for metrics labels
 * e.g., "/memory/some/path/here" -> "/memory/:path"
 */
export function normalizeRoute(path: string): string {
  // Known route patterns
  if (path.startsWith('/memory/')) return '/memory/:path';
  if (path.startsWith('/session/')) return '/session/:id';
  if (path.startsWith('/skills/')) return '/skills/:name';
  if (path.startsWith('/kv/')) return '/kv/:key';
  if (path.startsWith('/search')) return '/search';
  return path;
}
