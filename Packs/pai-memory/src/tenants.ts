/**
 * Tenant, User, and Membership management for PAI Memory.
 *
 * All functions take a pg Pool as first argument for standalone use.
 * No ORM — parameterized queries only.
 */

import type { Pool } from 'pg';
import type {
  Tenant, User, TenantMember, TenantRole,
  CreateTenantOptions, AddMemberOptions,
} from './types';

// ─── Tenants ────────────────────────────────────────────────────────────────

/** Create a new tenant. Returns the created tenant. */
export async function createTenant(pool: Pool, opts: CreateTenantOptions): Promise<Tenant> {
  const result = await pool.query<Tenant>(`
    INSERT INTO tenants (slug, type, name, settings)
    VALUES ($1, $2, $3, $4)
    RETURNING id, slug, type, name, settings,
              created_at as "createdAt", updated_at as "updatedAt"
  `, [opts.slug, opts.type, opts.name, JSON.stringify(opts.settings ?? {})]);
  return result.rows[0];
}

/** Get a tenant by slug or ID. */
export async function getTenant(pool: Pool, slugOrId: string): Promise<Tenant | null> {
  // Try UUID first, then slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const field = isUuid ? 'id' : 'slug';
  const result = await pool.query<Tenant>(`
    SELECT id, slug, type, name, settings,
           created_at as "createdAt", updated_at as "updatedAt"
    FROM tenants WHERE ${field} = $1
  `, [slugOrId]);
  return result.rows[0] ?? null;
}

/** List all tenants a user belongs to. */
export async function listTenants(pool: Pool, userId: string): Promise<Tenant[]> {
  const result = await pool.query<Tenant>(`
    SELECT t.id, t.slug, t.type, t.name, t.settings,
           t.created_at as "createdAt", t.updated_at as "updatedAt"
    FROM tenants t
    JOIN tenant_members tm ON t.id = tm.tenant_id
    WHERE tm.user_id = $1
    ORDER BY t.type ASC, t.name ASC
  `, [userId]);
  return result.rows;
}

/** Update a tenant's name and/or settings. */
export async function updateTenant(
  pool: Pool, id: string, opts: { name?: string; settings?: Record<string, unknown> }
): Promise<boolean> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [id];

  if (opts.name !== undefined) {
    params.push(opts.name);
    sets.push(`name = $${params.length}`);
  }
  if (opts.settings !== undefined) {
    params.push(JSON.stringify(opts.settings));
    sets.push(`settings = $${params.length}::jsonb`);
  }

  const result = await pool.query(
    `UPDATE tenants SET ${sets.join(', ')} WHERE id = $1`,
    params
  );
  return (result.rowCount ?? 0) > 0;
}

/** Delete a tenant. Cascades to memberships. */
export async function deleteTenant(pool: Pool, id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── Users ──────────────────────────────────────────────────────────────────

/** Create a new user. */
export async function createUser(
  pool: Pool, opts: { handle: string; email?: string }
): Promise<User> {
  const result = await pool.query<User>(`
    INSERT INTO users (handle, email)
    VALUES ($1, $2)
    RETURNING id, handle, email,
              default_tenant_id as "defaultTenantId",
              created_at as "createdAt", updated_at as "updatedAt"
  `, [opts.handle, opts.email ?? null]);
  return result.rows[0];
}

/** Get a user by handle or ID. */
export async function getUser(pool: Pool, handleOrId: string): Promise<User | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handleOrId);
  const field = isUuid ? 'id' : 'handle';
  const result = await pool.query<User>(`
    SELECT id, handle, email,
           default_tenant_id as "defaultTenantId",
           created_at as "createdAt", updated_at as "updatedAt"
    FROM users WHERE ${field} = $1
  `, [handleOrId]);
  return result.rows[0] ?? null;
}

/** Get a user by email address. */
export async function getUserByEmail(pool: Pool, email: string): Promise<User | null> {
  const result = await pool.query<User>(`
    SELECT id, handle, email,
           default_tenant_id as "defaultTenantId",
           created_at as "createdAt", updated_at as "updatedAt"
    FROM users WHERE email = $1
  `, [email]);
  return result.rows[0] ?? null;
}

// ─── Memberships ────────────────────────────────────────────────────────────

/** Add a user as a member of a tenant. */
export async function addMember(pool: Pool, opts: AddMemberOptions): Promise<void> {
  await pool.query(`
    INSERT INTO tenant_members (tenant_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, user_id)
    DO UPDATE SET role = EXCLUDED.role
  `, [opts.tenantId, opts.userId, opts.role]);
}

/** Remove a user from a tenant. */
export async function removeMember(
  pool: Pool, tenantId: string, userId: string
): Promise<void> {
  // Don't allow removing the last owner
  const owners = await pool.query(`
    SELECT COUNT(*) as count FROM tenant_members
    WHERE tenant_id = $1 AND role = 'owner'
  `, [tenantId]);

  const memberRole = await getMemberRole(pool, tenantId, userId);
  if (memberRole === 'owner' && parseInt(owners.rows[0].count) <= 1) {
    throw new Error('Cannot remove the last owner of a tenant');
  }

  await pool.query(
    'DELETE FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId]
  );
}

/** List all members of a tenant (with user handle). */
export async function listMembers(
  pool: Pool, tenantId: string
): Promise<(TenantMember & { handle: string; email?: string })[]> {
  const result = await pool.query<TenantMember & { handle: string; email?: string }>(`
    SELECT tm.tenant_id as "tenantId", tm.user_id as "userId",
           tm.role, tm.joined_at as "joinedAt",
           u.handle, u.email
    FROM tenant_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.tenant_id = $1
    ORDER BY tm.role ASC, u.handle ASC
  `, [tenantId]);
  return result.rows;
}

/** Get a user's role in a tenant. Returns null if not a member. */
export async function getMemberRole(
  pool: Pool, tenantId: string, userId: string
): Promise<TenantRole | null> {
  const result = await pool.query<{ role: TenantRole }>(`
    SELECT role FROM tenant_members
    WHERE tenant_id = $1 AND user_id = $2
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

// ─── Convenience ────────────────────────────────────────────────────────────

/**
 * Ensure a personal tenant exists for a user.
 * Creates one if it doesn't exist. Returns the personal tenant.
 */
export async function ensurePersonalTenant(pool: Pool, user: User): Promise<Tenant> {
  const slug = `${user.handle}-personal`;
  const existing = await getTenant(pool, slug);
  if (existing) return existing;

  const tenant = await createTenant(pool, {
    slug,
    type: 'personal',
    name: `${user.handle} (Personal)`,
  });

  await addMember(pool, {
    tenantId: tenant.id,
    userId: user.id,
    role: 'owner',
  });

  // Set as default tenant if user doesn't have one
  if (!user.defaultTenantId) {
    await pool.query(
      'UPDATE users SET default_tenant_id = $1 WHERE id = $2',
      [tenant.id, user.id]
    );
  }

  return tenant;
}
