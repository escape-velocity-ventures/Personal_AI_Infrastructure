/**
 * Cross-Channel Identity Resolution
 *
 * Maps platform-specific identifiers (phone, Slack, Discord, email, etc.) to unified contact identities.
 * Uses Harmony's contacts table as the authoritative contact registry.
 *
 * Design: ~/EscapeVelocity/ev-internal/harmony/design/cross-channel-identity-resolution.md
 * Bead: ev-internal-jtd.12
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createClient as createRedisClient, RedisClientType } from 'redis';

// ─── Types ──────────────────────────────────────────────────────────────────

export type IdentifierType =
  | 'phone'
  | 'email'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'github'
  | 'whatsapp';

export interface ContactIdentifier {
  type: IdentifierType;
  value: string;
  verified?: boolean;
}

export interface ResolvedIdentity {
  /** Harmony contact ID (null if unknown identifier) */
  contactId: string | null;
  /** All known identifiers for this contact */
  knownIdentifiers: ContactIdentifier[];
  /** Engram namespace list for memory queries */
  engramNamespaces: string[];
}

export interface ResolveOptions {
  /** Platform-specific identifier (e.g., '+15551234567', '@john.doe') */
  identifier: string;
  /** Identifier type */
  identifierType: IdentifierType;
  /** Business ID (tenant isolation) */
  businessId: string;
  /** Harmony Supabase URL (optional, reads from env if not provided) */
  supabaseUrl?: string;
  /** Harmony Supabase service key (optional, reads from env if not provided) */
  supabaseKey?: string;
  /** Redis URL for caching (optional, reads from env if not provided) */
  redisUrl?: string;
  /** Cache TTL in seconds (default: 300) */
  cacheTtl?: number;
}

interface ContactIdentifierRow {
  contact_id: string;
  identifier_type: string;
  identifier_value: string;
  verified: boolean;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL = 300; // 5 minutes

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Resolve a platform-specific identifier to a unified contact identity.
 *
 * Returns:
 * - contactId: Harmony contact UUID (null if unknown)
 * - knownIdentifiers: All linked identifiers for this contact
 * - engramNamespaces: Namespace list for Engram memory queries
 *
 * Caching:
 * - Uses Redis if available (5 min TTL by default)
 * - Falls back to direct DB query if Redis unavailable
 *
 * Graceful degradation:
 * - If Harmony DB unavailable: returns null contactId, platform-specific namespace only
 * - If identifier unknown: returns null contactId, allows caller to use fallback namespace
 *
 * @example
 * const resolved = await resolveIdentity({
 *   identifier: '@john.doe',
 *   identifierType: 'slack',
 *   businessId: 'abc-123',
 * });
 *
 * const memories = await engramClient.search('recent conversation', {
 *   tenantIds: resolved.engramNamespaces,
 * });
 */
export async function resolveIdentity(options: ResolveOptions): Promise<ResolvedIdentity> {
  const {
    identifier,
    identifierType,
    businessId,
    supabaseUrl = process.env.HARMONY_SUPABASE_URL,
    supabaseKey = process.env.HARMONY_SUPABASE_KEY,
    redisUrl = process.env.REDIS_URL,
    cacheTtl = DEFAULT_CACHE_TTL,
  } = options;

  // Validate required parameters
  if (!identifier || !identifierType || !businessId) {
    throw new Error('identifier, identifierType, and businessId are required');
  }

  // Try cache first (if Redis configured)
  if (redisUrl) {
    const cached = await getCachedIdentity(redisUrl, businessId, identifierType, identifier);
    if (cached) return cached;
  }

  // Query Harmony DB
  if (!supabaseUrl || !supabaseKey) {
    // No Harmony credentials — return degraded result (platform-specific namespace only)
    return createDegradedResult(businessId, identifierType, identifier);
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await resolveFromDatabase(supabase, businessId, identifierType, identifier);

    // Cache result (if Redis configured)
    if (redisUrl && result.contactId) {
      await cacheIdentity(redisUrl, businessId, identifierType, identifier, result, cacheTtl);
    }

    return result;
  } catch (error) {
    console.error('[identity-resolver] Database query failed:', error);
    // Graceful degradation: return platform-specific namespace
    return createDegradedResult(businessId, identifierType, identifier);
  }
}

// ─── Database Resolution ────────────────────────────────────────────────────

async function resolveFromDatabase(
  supabase: SupabaseClient,
  businessId: string,
  identifierType: IdentifierType,
  identifier: string
): Promise<ResolvedIdentity> {
  // Query contact_identifiers table
  const { data, error } = await supabase
    .from('contact_identifiers')
    .select('contact_id, identifier_type, identifier_value, verified')
    .eq('business_id', businessId)
    .eq('identifier_type', identifierType)
    .eq('identifier_value', identifier)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query contact_identifiers: ${error.message}`);
  }

  // Unknown identifier — return degraded result
  if (!data) {
    return createDegradedResult(businessId, identifierType, identifier);
  }

  const contactId = data.contact_id;

  // Fetch ALL identifiers for this contact
  const { data: allIdentifiers, error: allError } = await supabase
    .from('contact_identifiers')
    .select('identifier_type, identifier_value, verified')
    .eq('business_id', businessId)
    .eq('contact_id', contactId);

  if (allError) {
    throw new Error(`Failed to fetch all identifiers: ${allError.message}`);
  }

  const knownIdentifiers: ContactIdentifier[] = (allIdentifiers || []).map((row: ContactIdentifierRow) => ({
    type: row.identifier_type as IdentifierType,
    value: row.identifier_value,
    verified: row.verified,
  }));

  // Generate Engram namespaces
  const namespaces = generateNamespaces(businessId, contactId, knownIdentifiers);

  return {
    contactId,
    knownIdentifiers,
    engramNamespaces: namespaces,
  };
}

// ─── Namespace Generation ───────────────────────────────────────────────────

function generateNamespaces(
  businessId: string,
  contactId: string,
  identifiers: ContactIdentifier[]
): string[] {
  const namespaces = new Set<string>();

  // Personal namespace (contact-centric)
  namespaces.add(`personal:${contactId}`);

  // Platform-specific namespaces (deterministic, supports progressive linking)
  for (const id of identifiers) {
    namespaces.add(`${id.type}:${businessId}:${id.value}`);
  }

  // Org-wide namespace (shared knowledge)
  namespaces.add(`org:${businessId}`);

  return Array.from(namespaces);
}

// ─── Degraded Mode ──────────────────────────────────────────────────────────

/**
 * Returns a result for unknown identifiers or when Harmony DB is unavailable.
 * Uses platform-specific namespace only — no cross-channel linking.
 */
function createDegradedResult(
  businessId: string,
  identifierType: IdentifierType,
  identifier: string
): ResolvedIdentity {
  return {
    contactId: null,
    knownIdentifiers: [],
    engramNamespaces: [
      // Platform-specific namespace (deterministic — future linking makes this retroactively useful)
      `${identifierType}:${businessId}:${identifier}`,
      // Org-wide namespace (shared knowledge)
      `org:${businessId}`,
    ],
  };
}

// ─── Redis Caching ──────────────────────────────────────────────────────────

function getCacheKey(businessId: string, identifierType: IdentifierType, identifier: string): string {
  return `identity:${businessId}:${identifierType}:${identifier}`;
}

async function getCachedIdentity(
  redisUrl: string,
  businessId: string,
  identifierType: IdentifierType,
  identifier: string
): Promise<ResolvedIdentity | null> {
  let redis: RedisClientType | null = null;
  try {
    redis = createRedisClient({ url: redisUrl }) as RedisClientType;
    await redis.connect();

    const key = getCacheKey(businessId, identifierType, identifier);
    const cached = await redis.get(key);

    if (cached) {
      return JSON.parse(cached) as ResolvedIdentity;
    }

    return null;
  } catch (error) {
    console.warn('[identity-resolver] Redis cache read failed:', error);
    return null;
  } finally {
    if (redis) {
      await redis.disconnect();
    }
  }
}

async function cacheIdentity(
  redisUrl: string,
  businessId: string,
  identifierType: IdentifierType,
  identifier: string,
  result: ResolvedIdentity,
  ttl: number
): Promise<void> {
  let redis: RedisClientType | null = null;
  try {
    redis = createRedisClient({ url: redisUrl }) as RedisClientType;
    await redis.connect();

    const key = getCacheKey(businessId, identifierType, identifier);
    await redis.setEx(key, ttl, JSON.stringify(result));
  } catch (error) {
    console.warn('[identity-resolver] Redis cache write failed:', error);
    // Non-fatal — continue without caching
  } finally {
    if (redis) {
      await redis.disconnect();
    }
  }
}

// ─── Linking Helpers (for future use) ───────────────────────────────────────

/**
 * Link a new identifier to an existing contact.
 * Used by: NanoClaw when Slack API provides email that matches existing contact.
 *
 * @example
 * await linkIdentifier({
 *   contactId: 'def-456',
 *   identifierType: 'slack',
 *   identifier: '@john.doe',
 *   businessId: 'abc-123',
 *   verified: true,
 *   supabaseUrl: env.HARMONY_SUPABASE_URL,
 *   supabaseKey: env.HARMONY_SERVICE_KEY,
 * });
 */
export async function linkIdentifier(options: {
  contactId: string;
  identifierType: IdentifierType;
  identifier: string;
  businessId: string;
  verified?: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
}): Promise<void> {
  const {
    contactId,
    identifierType,
    identifier,
    businessId,
    verified = false,
    supabaseUrl = process.env.HARMONY_SUPABASE_URL,
    supabaseKey = process.env.HARMONY_SUPABASE_KEY,
  } = options;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Harmony Supabase credentials required for linkIdentifier');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error } = await supabase
    .from('contact_identifiers')
    .upsert({
      contact_id: contactId,
      business_id: businessId,
      identifier_type: identifierType,
      identifier_value: identifier,
      verified,
      linked_at: new Date().toISOString(),
    }, {
      onConflict: 'business_id,identifier_type,identifier_value',
    });

  if (error) {
    throw new Error(`Failed to link identifier: ${error.message}`);
  }
}

/**
 * Create a new contact with an initial identifier.
 * Used by: NanoClaw when receiving message from unknown user.
 *
 * Returns: contactId
 *
 * @example
 * const contactId = await createContact({
 *   businessId: 'abc-123',
 *   identifierType: 'slack',
 *   identifier: '@new.user',
 *   name: 'New User',
 *   supabaseUrl: env.HARMONY_SUPABASE_URL,
 *   supabaseKey: env.HARMONY_SERVICE_KEY,
 * });
 */
export async function createContact(options: {
  businessId: string;
  identifierType: IdentifierType;
  identifier: string;
  name?: string;
  email?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}): Promise<string> {
  const {
    businessId,
    identifierType,
    identifier,
    name,
    email,
    supabaseUrl = process.env.HARMONY_SUPABASE_URL,
    supabaseKey = process.env.HARMONY_SUPABASE_KEY,
  } = options;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Harmony Supabase credentials required for createContact');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create contact
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .insert({
      business_id: businessId,
      name: name || 'Unknown',
      email: email || null,
      phone_number: identifierType === 'phone' ? identifier : null,
      metadata: {},
    })
    .select('id')
    .single();

  if (contactError) {
    throw new Error(`Failed to create contact: ${contactError.message}`);
  }

  const contactId = contact.id;

  // Link identifier
  await linkIdentifier({
    contactId,
    businessId,
    identifierType,
    identifier,
    verified: false, // New contact, not yet verified
    supabaseUrl,
    supabaseKey,
  });

  return contactId;
}
