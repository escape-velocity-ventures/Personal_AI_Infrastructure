-- Migration: 001-multi-tenancy.sql
-- Description: Adds multi-tenancy support to PAI memory service with RLS
-- Author: PAI Engineer Agent
-- Date: 2026-03-09
--
-- IMPORTANT: RLS is bypassed for table owners and superusers.
-- The 'memory' role must NOT be a superuser for RLS to take effect.
-- For migrations/backfill scripts that need to bypass RLS, use:
--   SET ROLE memory_admin;

BEGIN;

-- ==============================================================================
-- CREATE CORE MULTI-TENANCY TABLES
-- ==============================================================================

-- Users table: represents individual users across all tenants
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle            text NOT NULL UNIQUE,
  email             text,
  default_tenant_id uuid,  -- FK added after tenants table exists
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Individual users who can belong to multiple tenants';
COMMENT ON COLUMN users.handle IS 'Unique username/handle across the system';
COMMENT ON COLUMN users.default_tenant_id IS 'Users primary tenant for scope resolution';

-- Tenants table: organizations or personal workspaces
CREATE TABLE IF NOT EXISTS tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  type       text NOT NULL CHECK (type IN ('personal', 'organization')),
  name       text NOT NULL,
  settings   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenants IS 'Organizations or personal workspaces that contain memory data';
COMMENT ON COLUMN tenants.slug IS 'URL-safe unique identifier for tenant';
COMMENT ON COLUMN tenants.type IS 'personal = single-user workspace, organization = multi-user team';
COMMENT ON COLUMN tenants.settings IS 'Tenant-specific configuration (retention policies, etc)';

-- Now add the FK constraint from users to tenants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_users_default_tenant'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_default_tenant
      FOREIGN KEY (default_tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

-- Tenant membership: which users belong to which tenants
CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'reader')),
  joined_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

COMMENT ON TABLE tenant_members IS 'Many-to-many relationship between users and tenants';
COMMENT ON COLUMN tenant_members.role IS 'owner = full control, admin = manage members, member = read/write, reader = read-only';

-- Index for user-to-tenants lookups (common query pattern)
CREATE INDEX IF NOT EXISTS idx_tenant_members_user
  ON tenant_members(user_id);

-- ==============================================================================
-- ALTER EXISTING TABLES FOR MULTI-TENANCY
-- ==============================================================================

-- memory_chunks: add tenant isolation and authorship tracking
ALTER TABLE memory_chunks
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

ALTER TABLE memory_chunks
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES users(id);

ALTER TABLE memory_chunks
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'org'
  CHECK (scope IN ('personal', 'org', 'team'));

COMMENT ON COLUMN memory_chunks.tenant_id IS 'Which tenant owns this memory chunk';
COMMENT ON COLUMN memory_chunks.author_id IS 'User who created this chunk (for audit trail)';
COMMENT ON COLUMN memory_chunks.scope IS 'personal = private to author, org = shared across tenant, team = shared with specific team (future)';

-- Indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_chunks_tenant
  ON memory_chunks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_chunks_author
  ON memory_chunks(author_id);

CREATE INDEX IF NOT EXISTS idx_chunks_scope
  ON memory_chunks(scope);

-- Composite index for most common query pattern: tenant + scope filtering
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_scope
  ON memory_chunks(tenant_id, scope);

-- command_log: add tenant isolation and authorship
ALTER TABLE command_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

ALTER TABLE command_log
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES users(id);

COMMENT ON COLUMN command_log.tenant_id IS 'Which tenant this command belongs to';
COMMENT ON COLUMN command_log.author_id IS 'User who executed this command';

CREATE INDEX IF NOT EXISTS idx_cmdlog_tenant
  ON command_log(tenant_id);

-- entities: add tenant isolation
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

COMMENT ON COLUMN entities.tenant_id IS 'Which tenant owns this entity';

CREATE INDEX IF NOT EXISTS idx_entities_tenant
  ON entities(tenant_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- memory_chunks policies
-- ---------------------------------------------------------------------------

-- SELECT: users see chunks in their tenants (plus backward-compat NULL tenant_id)
CREATE POLICY tenant_isolation_select ON memory_chunks FOR SELECT
  USING (
    tenant_id IS NULL  -- Backward compatibility: un-migrated rows visible to all
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- INSERT: users can only create chunks in tenants they belong to
CREATE POLICY tenant_isolation_insert ON memory_chunks FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- UPDATE: users can only update chunks in their tenants
CREATE POLICY tenant_isolation_update ON memory_chunks FOR UPDATE
  USING (
    tenant_id IS NULL  -- Allow updating legacy data during migration
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- DELETE: users can only delete chunks in their tenants
CREATE POLICY tenant_isolation_delete ON memory_chunks FOR DELETE
  USING (
    tenant_id IS NULL  -- Allow deleting legacy data during migration
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- command_log policies
-- ---------------------------------------------------------------------------

-- SELECT: users see commands in their tenants
CREATE POLICY tenant_isolation_select ON command_log FOR SELECT
  USING (
    tenant_id IS NULL  -- Backward compatibility
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- INSERT: users can only log commands in their tenants
CREATE POLICY tenant_isolation_insert ON command_log FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- entities policies
-- ---------------------------------------------------------------------------

-- SELECT: users see entities in their tenants
CREATE POLICY tenant_isolation_select ON entities FOR SELECT
  USING (
    tenant_id IS NULL  -- Backward compatibility
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- INSERT: users can only create entities in their tenants
CREATE POLICY tenant_isolation_insert ON entities FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- tenant_members policies
-- ---------------------------------------------------------------------------

-- SELECT: users see their own memberships + can see all members if they're owner/admin
CREATE POLICY member_isolation ON tenant_members FOR SELECT
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- ==============================================================================
-- NOTES FOR OPERATORS
-- ==============================================================================

-- To set the current user context for RLS (typically done in application code):
--   SET LOCAL app.current_user_id = 'uuid-of-user';
--
-- To bypass RLS during migrations/backfill (requires superuser or BYPASSRLS privilege):
--   SET ROLE memory_admin;  -- Assuming memory_admin has BYPASSRLS
--
-- To check if RLS is enabled on a table:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'memory_chunks';
--
-- To verify the 'memory' role is NOT a superuser (required for RLS to work):
--   SELECT rolname, rolsuper FROM pg_roles WHERE rolname = 'memory';
--   -- rolsuper should be FALSE

COMMIT;
