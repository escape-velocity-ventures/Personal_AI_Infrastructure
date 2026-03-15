/**
 * JWT Authentication Middleware for PAI Memory API
 *
 * Supports three auth modes (checked in order):
 * 1. JWT (MEMORY_JWT_SECRET set) — full multi-tenant auth
 * 2. API Key (MEMORY_API_KEY set) — legacy single-tenant auth
 * 3. No auth (neither set) — dev mode with warning
 */

import { type Context, type MiddlewareHandler } from 'hono';
import * as jose from 'jose';
import type { TenantContext } from './types';

const JWT_SECRET = process.env.MEMORY_JWT_SECRET;
const API_KEY = process.env.MEMORY_API_KEY;
const PUBLIC_PATHS = ['/health', '/ready', '/metrics', '/mcp'];

interface JWTPayload {
  sub: string;        // user handle
  user_id: string;    // uuid
  tenants: Array<{ id: string; slug: string; role: string }>;
}

/**
 * Extract TenantContext from Hono context.
 * Returns null if no auth (dev mode or public path).
 */
export function getTenantContext(c: Context): TenantContext | null {
  return c.get('tenant') as TenantContext | null ?? null;
}

/**
 * Auth middleware — checks JWT first, falls back to API key.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(c.req.path)) return next();

  const authHeader = c.req.header('Authorization');

  // Mode 1: JWT auth
  if (JWT_SECRET) {
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const token = authHeader.substring(7);

    try {
      const secret = new TextEncoder().encode(JWT_SECRET);
      const { payload } = await jose.jwtVerify(token, secret);
      const claims = payload as unknown as JWTPayload;

      if (!claims.user_id || !claims.tenants) {
        return c.json({ error: 'Invalid JWT: missing user_id or tenants claim' }, 401);
      }

      const tenantContext: TenantContext = {
        userId: claims.user_id,
        tenantIds: claims.tenants.map(t => t.id),
        activeTenantId: claims.tenants[0]?.id,
      };

      c.set('tenant', tenantContext);
      return next();
    } catch (err) {
      // If JWT verification fails but API_KEY is also set, try API key
      if (API_KEY && authHeader.substring(7) === API_KEY) {
        // Legacy API key mode — no tenant context
        return next();
      }
      return c.json({ error: 'Invalid or expired JWT' }, 401);
    }
  }

  // Mode 2: API Key auth (legacy)
  if (API_KEY) {
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    if (authHeader.substring(7) !== API_KEY) {
      return c.json({ error: 'Invalid API key' }, 401);
    }
    return next();
  }

  // Mode 3: No auth (dev mode)
  console.warn('WARNING: No MEMORY_JWT_SECRET or MEMORY_API_KEY set — running without authentication');
  return next();
};

/**
 * Middleware to set PostgreSQL session variable for RLS.
 * Must run AFTER authMiddleware. Only sets the variable if tenant context exists.
 * Takes a pg Pool reference to execute SET LOCAL.
 */
export function createRlsMiddleware(pool: { query: (text: string, values?: unknown[]) => Promise<unknown> }): MiddlewareHandler {
  return async (c, next) => {
    const ctx = getTenantContext(c);
    if (ctx?.userId) {
      // SET LOCAL only lasts for the current transaction
      // For non-transactional queries, use set_config with is_local=true
      await pool.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
    }
    return next();
  };
}
