/**
 * JWT token generation utilities for PAI Memory
 *
 * Used by:
 * - Setup scripts to create initial admin tokens
 * - Tests to create test user tokens
 * - CLI tools for local development
 */

import * as jose from 'jose';

interface TokenOptions {
  userId: string;
  handle: string;
  tenants: Array<{ id: string; slug: string; role: string }>;
  expiresIn?: string;  // e.g., '7d', '1h', '30d'
}

/**
 * Generate a signed JWT for PAI Memory authentication.
 */
export async function generateToken(secret: string, opts: TokenOptions): Promise<string> {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);

  const jwt = await new jose.SignJWT({
    sub: opts.handle,
    user_id: opts.userId,
    tenants: opts.tenants,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('pai-memory')
    .setExpirationTime(opts.expiresIn ?? '30d')
    .sign(key);

  return jwt;
}

/**
 * Decode a JWT without verification (for debugging).
 */
export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    return jose.decodeJwt(token) as Record<string, unknown>;
  } catch {
    return null;
  }
}
