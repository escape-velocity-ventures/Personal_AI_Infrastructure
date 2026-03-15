-- Migration: 002-memory-sources.sql
-- Description: Adds memory source management tables for git repos, uploads, and credential storage
-- Author: PAI Engineer Agent
-- Date: 2026-03-09
--
-- Depends on: 001-multi-tenancy.sql (tenants, users, tenant_members)
--
-- Tables created:
--   source_credentials  - Encrypted PATs, SSH keys, deploy keys for git providers
--   memory_sources      - Configured knowledge sources (git repos, uploads, etc.)
--   source_file_state   - Per-file sync tracking for incremental updates

BEGIN;

-- ==============================================================================
-- SOURCE CREDENTIALS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS source_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL,
  auth_type       text NOT NULL CHECK (auth_type IN ('pat', 'ssh_key', 'deploy_key')),
  provider        text NOT NULL CHECK (provider IN ('github', 'gitea', 'gitlab')),
  encrypted_value bytea NOT NULL,
  encrypted_iv    bytea NOT NULL,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  created_by      uuid REFERENCES users(id),
  UNIQUE (tenant_id, name)
);

COMMENT ON TABLE source_credentials IS 'Encrypted credentials (PATs, SSH keys, deploy keys) for accessing git providers';
COMMENT ON COLUMN source_credentials.auth_type IS 'pat = personal access token, ssh_key = SSH private key, deploy_key = repo-scoped deploy key';
COMMENT ON COLUMN source_credentials.provider IS 'Git provider this credential authenticates against';
COMMENT ON COLUMN source_credentials.encrypted_value IS 'AES-256-GCM encrypted credential value';
COMMENT ON COLUMN source_credentials.encrypted_iv IS 'Initialization vector for AES-256-GCM decryption';
COMMENT ON COLUMN source_credentials.expires_at IS 'When this credential expires (NULL = no expiration)';
COMMENT ON COLUMN source_credentials.last_used_at IS 'Last time this credential was used for a sync';

-- Indexes for source_credentials
CREATE INDEX IF NOT EXISTS idx_source_credentials_tenant
  ON source_credentials(tenant_id);

-- ==============================================================================
-- MEMORY SOURCES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS memory_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  name             text NOT NULL,
  source_type      text NOT NULL CHECK (source_type IN ('git_repo', 'local_path', 'upload', 'claude_memory')),
  repo_url         text,
  branch           text NOT NULL DEFAULT 'main',
  base_path        text NOT NULL DEFAULT '',
  include_globs    text[] NOT NULL DEFAULT '{**/*.md}',
  exclude_globs    text[] NOT NULL DEFAULT '{node_modules/**,*.lock,.git/**}',
  credential_id    uuid REFERENCES source_credentials(id),
  sync_schedule    text NOT NULL DEFAULT 'manual',
  sync_enabled     boolean NOT NULL DEFAULT true,
  chunk_strategy   text NOT NULL DEFAULT 'heading',
  default_tags     text[] NOT NULL DEFAULT '{}',
  last_sync_at     timestamptz,
  last_sync_hash   text,
  last_sync_stats  jsonb NOT NULL DEFAULT '{}',
  sync_status      text NOT NULL DEFAULT 'pending',
  sync_error       text,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  created_by       uuid REFERENCES users(id),
  UNIQUE (tenant_id, name)
);

COMMENT ON TABLE memory_sources IS 'Configured knowledge sources that feed memory chunks (git repos, uploads, local paths)';
COMMENT ON COLUMN memory_sources.source_type IS 'git_repo = remote git repository, local_path = local filesystem, upload = user upload, claude_memory = Claude memory export';
COMMENT ON COLUMN memory_sources.repo_url IS 'Git clone URL (required for git_repo type)';
COMMENT ON COLUMN memory_sources.branch IS 'Git branch to track';
COMMENT ON COLUMN memory_sources.base_path IS 'Subdirectory within repo to scope indexing';
COMMENT ON COLUMN memory_sources.include_globs IS 'File patterns to include in indexing';
COMMENT ON COLUMN memory_sources.exclude_globs IS 'File patterns to exclude from indexing';
COMMENT ON COLUMN memory_sources.credential_id IS 'Optional credential for authenticated access';
COMMENT ON COLUMN memory_sources.sync_schedule IS 'manual = on-demand only, or cron expression for periodic sync';
COMMENT ON COLUMN memory_sources.chunk_strategy IS 'How to split files into memory chunks (heading, paragraph, fixed-size)';
COMMENT ON COLUMN memory_sources.default_tags IS 'Tags automatically applied to chunks from this source';
COMMENT ON COLUMN memory_sources.last_sync_hash IS 'Git commit hash or content hash from last successful sync';
COMMENT ON COLUMN memory_sources.last_sync_stats IS 'Stats from last sync: {files_processed, chunks_created, chunks_updated, chunks_deleted, duration_ms}';
COMMENT ON COLUMN memory_sources.sync_status IS 'pending = never synced, syncing = in progress, synced = complete, error = last sync failed';
COMMENT ON COLUMN memory_sources.sync_error IS 'Error message from last failed sync attempt';

-- Indexes for memory_sources
CREATE INDEX IF NOT EXISTS idx_memory_sources_tenant
  ON memory_sources(tenant_id);

CREATE INDEX IF NOT EXISTS idx_memory_sources_source_type
  ON memory_sources(source_type);

CREATE INDEX IF NOT EXISTS idx_memory_sources_sync_status
  ON memory_sources(sync_status);

CREATE INDEX IF NOT EXISTS idx_memory_sources_credential
  ON memory_sources(credential_id);

-- ==============================================================================
-- SOURCE FILE STATE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS source_file_state (
  source_id    uuid NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  content_hash text NOT NULL,
  last_synced  timestamptz NOT NULL DEFAULT NOW(),
  chunk_ids    uuid[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (source_id, file_path)
);

COMMENT ON TABLE source_file_state IS 'Per-file tracking for incremental sync — only re-process files whose content_hash changed';
COMMENT ON COLUMN source_file_state.content_hash IS 'SHA-256 of file content for change detection';
COMMENT ON COLUMN source_file_state.last_synced IS 'When this file was last processed';
COMMENT ON COLUMN source_file_state.chunk_ids IS 'Memory chunk IDs generated from this file (for targeted deletion on re-sync)';

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on all new tables
ALTER TABLE source_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_file_state ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- source_credentials policies
-- Only admin/owner can read or write credentials (sensitive material)
-- ---------------------------------------------------------------------------

-- SELECT: only admin/owner of the tenant can see credentials
CREATE POLICY creds_tenant_select ON source_credentials FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- INSERT: only admin/owner can create credentials
CREATE POLICY creds_tenant_insert ON source_credentials FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- UPDATE: only admin/owner can update credentials
CREATE POLICY creds_tenant_update ON source_credentials FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- DELETE: only admin/owner can delete credentials
CREATE POLICY creds_tenant_delete ON source_credentials FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- memory_sources policies
-- All tenant members can read sources, only admin/owner can write
-- ---------------------------------------------------------------------------

-- SELECT: all tenant members can see sources
CREATE POLICY sources_tenant_select ON memory_sources FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- INSERT: only admin/owner can create sources
CREATE POLICY sources_tenant_insert ON memory_sources FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- UPDATE: only admin/owner can update sources
CREATE POLICY sources_tenant_update ON memory_sources FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- DELETE: only admin/owner can delete sources
CREATE POLICY sources_tenant_delete ON memory_sources FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- source_file_state policies
-- Accessible to tenant members via join on memory_sources
-- ---------------------------------------------------------------------------

-- SELECT: tenant members can see file state for sources they can access
CREATE POLICY file_state_tenant_select ON source_file_state FOR SELECT
  USING (
    source_id IN (
      SELECT ms.id FROM memory_sources ms
      JOIN tenant_members tm ON tm.tenant_id = ms.tenant_id
      WHERE tm.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- INSERT: admin/owner can create file state entries (sync operations)
CREATE POLICY file_state_tenant_insert ON source_file_state FOR INSERT
  WITH CHECK (
    source_id IN (
      SELECT ms.id FROM memory_sources ms
      JOIN tenant_members tm ON tm.tenant_id = ms.tenant_id
      WHERE tm.user_id = current_setting('app.current_user_id', true)::uuid
      AND tm.role IN ('owner', 'admin')
    )
  );

-- UPDATE: admin/owner can update file state (re-sync operations)
CREATE POLICY file_state_tenant_update ON source_file_state FOR UPDATE
  USING (
    source_id IN (
      SELECT ms.id FROM memory_sources ms
      JOIN tenant_members tm ON tm.tenant_id = ms.tenant_id
      WHERE tm.user_id = current_setting('app.current_user_id', true)::uuid
      AND tm.role IN ('owner', 'admin')
    )
  );

-- DELETE: admin/owner can delete file state (cascade handles most, but explicit for completeness)
CREATE POLICY file_state_tenant_delete ON source_file_state FOR DELETE
  USING (
    source_id IN (
      SELECT ms.id FROM memory_sources ms
      JOIN tenant_members tm ON tm.tenant_id = ms.tenant_id
      WHERE tm.user_id = current_setting('app.current_user_id', true)::uuid
      AND tm.role IN ('owner', 'admin')
    )
  );

-- ==============================================================================
-- NOTES FOR OPERATORS
-- ==============================================================================

-- Encryption key management:
--   The encrypted_value/encrypted_iv columns use AES-256-GCM.
--   The encryption key is stored in the application config (ENGRAM_CREDENTIAL_KEY env var),
--   NOT in the database. Rotate by re-encrypting all rows with the new key.
--
-- Sync scheduling:
--   sync_schedule accepts 'manual' or standard cron expressions (e.g., '0 */6 * * *').
--   The sync worker reads memory_sources WHERE sync_enabled = true AND sync_schedule != 'manual'.
--
-- To manually trigger a sync:
--   UPDATE memory_sources SET sync_status = 'pending' WHERE id = '<source-id>';

COMMIT;
