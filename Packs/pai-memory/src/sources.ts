/**
 * Memory Sources, Credentials, and File State management for Engram.
 *
 * All functions take a pg Pool as first argument for standalone use.
 * No ORM — parameterized queries only.
 */

import type { Pool } from 'pg';
import type {
  MemorySource, SourceCredential, SourceFileState,
  CreateSourceOptions, UpdateSourceOptions, CreateCredentialOptions,
  SyncStats, SyncStatus,
} from './types';
import { encrypt, decrypt } from './crypto';
import { execSync } from 'child_process';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Sources ────────────────────────────────────────────────────────────────

/** Create a new memory source. Returns the created source. */
export async function createSource(pool: Pool, opts: CreateSourceOptions): Promise<MemorySource> {
  const result = await pool.query<MemorySource>(`
    INSERT INTO memory_sources (
      tenant_id, name, source_type, repo_url, branch, base_path,
      include_globs, exclude_globs, credential_id, sync_schedule,
      chunk_strategy, default_tags, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    )
    RETURNING *
  `, [
    opts.tenant_id,
    opts.name,
    opts.source_type,
    opts.repo_url ?? null,
    opts.branch ?? 'main',
    opts.base_path ?? '',
    opts.include_globs ?? ['**/*.md'],
    opts.exclude_globs ?? ['**/node_modules/**', '**/.git/**'],
    opts.credential_id ?? null,
    opts.sync_schedule ?? 'manual',
    opts.chunk_strategy ?? 'heading',
    opts.default_tags ?? [],
    opts.created_by ?? null,
  ]);
  return result.rows[0];
}

/** Get a source by ID or name (scoped to tenant). */
export async function getSource(
  pool: Pool, idOrName: string, tenantId: string
): Promise<MemorySource | null> {
  const isUuid = UUID_RE.test(idOrName);
  const query = isUuid
    ? 'SELECT * FROM memory_sources WHERE id = $1'
    : 'SELECT * FROM memory_sources WHERE name = $1 AND tenant_id = $2';
  const params = isUuid ? [idOrName] : [idOrName, tenantId];
  const result = await pool.query<MemorySource>(query, params);
  return result.rows[0] ?? null;
}

/** List all sources for a tenant. */
export async function listSources(pool: Pool, tenantId: string): Promise<MemorySource[]> {
  const result = await pool.query<MemorySource>(
    'SELECT * FROM memory_sources WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  return result.rows;
}

/** Update a source. Returns true if a row was updated. */
export async function updateSource(
  pool: Pool, id: string, opts: UpdateSourceOptions
): Promise<boolean> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [id];

  if (opts.name !== undefined) {
    params.push(opts.name);
    sets.push(`name = $${params.length}`);
  }
  if (opts.branch !== undefined) {
    params.push(opts.branch);
    sets.push(`branch = $${params.length}`);
  }
  if (opts.base_path !== undefined) {
    params.push(opts.base_path);
    sets.push(`base_path = $${params.length}`);
  }
  if (opts.include_globs !== undefined) {
    params.push(opts.include_globs);
    sets.push(`include_globs = $${params.length}`);
  }
  if (opts.exclude_globs !== undefined) {
    params.push(opts.exclude_globs);
    sets.push(`exclude_globs = $${params.length}`);
  }
  if (opts.credential_id !== undefined) {
    params.push(opts.credential_id);
    sets.push(`credential_id = $${params.length}`);
  }
  if (opts.sync_schedule !== undefined) {
    params.push(opts.sync_schedule);
    sets.push(`sync_schedule = $${params.length}`);
  }
  if (opts.sync_enabled !== undefined) {
    params.push(opts.sync_enabled);
    sets.push(`sync_enabled = $${params.length}`);
  }
  if (opts.chunk_strategy !== undefined) {
    params.push(opts.chunk_strategy);
    sets.push(`chunk_strategy = $${params.length}`);
  }
  if (opts.default_tags !== undefined) {
    params.push(opts.default_tags);
    sets.push(`default_tags = $${params.length}`);
  }

  const result = await pool.query(
    `UPDATE memory_sources SET ${sets.join(', ')} WHERE id = $1`,
    params
  );
  return (result.rowCount ?? 0) > 0;
}

/** Delete a source. Optionally delete associated memory chunks. */
export async function deleteSource(
  pool: Pool, id: string, deleteChunks?: boolean
): Promise<boolean> {
  if (deleteChunks) {
    const states = await pool.query<{ chunk_ids: string[] }>(
      'SELECT chunk_ids FROM source_file_state WHERE source_id = $1',
      [id]
    );
    const allChunkIds = states.rows.flatMap(r => r.chunk_ids);
    if (allChunkIds.length > 0) {
      await pool.query(
        'DELETE FROM memory_chunks WHERE id = ANY($1::uuid[])',
        [allChunkIds]
      );
    }
  }

  const result = await pool.query(
    'DELETE FROM memory_sources WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Update the sync status of a source. */
export async function updateSyncStatus(
  pool: Pool,
  id: string,
  status: SyncStatus,
  opts?: { hash?: string; stats?: SyncStats; error?: string }
): Promise<void> {
  const sets: string[] = [
    'sync_status = $2',
    'updated_at = NOW()',
  ];
  const params: unknown[] = [id, status];

  if (status === 'synced') {
    sets.push('last_sync_at = NOW()');
  }

  if (opts?.hash !== undefined) {
    params.push(opts.hash);
    sets.push(`last_sync_hash = $${params.length}`);
  }
  if (opts?.stats !== undefined) {
    params.push(JSON.stringify(opts.stats));
    sets.push(`last_sync_stats = $${params.length}::jsonb`);
  }
  if (opts?.error !== undefined) {
    params.push(opts.error);
    sets.push(`sync_error = $${params.length}`);
  } else if (status === 'synced') {
    sets.push('sync_error = NULL');
  }

  await pool.query(
    `UPDATE memory_sources SET ${sets.join(', ')} WHERE id = $1`,
    params
  );
}

// ─── Credentials ────────────────────────────────────────────────────────────

/** Create an encrypted credential. Returns id and name only. */
export async function createCredential(
  pool: Pool, opts: CreateCredentialOptions
): Promise<{ id: string; name: string }> {
  const { encrypted, iv } = encrypt(opts.value);

  const result = await pool.query<{ id: string; name: string }>(`
    INSERT INTO source_credentials (
      tenant_id, name, auth_type, provider,
      encrypted_value, encrypted_iv, expires_at, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, name
  `, [
    opts.tenant_id,
    opts.name,
    opts.auth_type,
    opts.provider ?? null,
    encrypted,
    iv,
    opts.expires_at ?? null,
    opts.created_by ?? null,
  ]);
  return result.rows[0];
}

/** List credentials for a tenant. Never returns encrypted values. */
export async function listCredentials(
  pool: Pool, tenantId: string
): Promise<Array<{
  id: string; name: string; auth_type: string; provider: string | null;
  expires_at: string | null; last_used_at: string | null; created_at: string;
}>> {
  const result = await pool.query(`
    SELECT id, name, auth_type, provider, expires_at, last_used_at, created_at
    FROM source_credentials
    WHERE tenant_id = $1
    ORDER BY created_at DESC
  `, [tenantId]);
  return result.rows;
}

/** Decrypt and return a credential's plaintext value. Updates last_used_at. */
export async function getCredentialValue(pool: Pool, id: string): Promise<string> {
  const result = await pool.query<{ encrypted_value: string; encrypted_iv: string }>(
    'SELECT encrypted_value, encrypted_iv FROM source_credentials WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) {
    throw new Error(`Credential ${id} not found`);
  }

  const { encrypted_value, encrypted_iv } = result.rows[0];
  const plaintext = decrypt(encrypted_value, encrypted_iv);

  await pool.query(
    'UPDATE source_credentials SET last_used_at = NOW() WHERE id = $1',
    [id]
  );

  return plaintext;
}

/** Delete a credential. Throws if it is in use by any source. */
export async function deleteCredential(pool: Pool, id: string): Promise<boolean> {
  const inUse = await pool.query(
    'SELECT id FROM memory_sources WHERE credential_id = $1 LIMIT 1',
    [id]
  );
  if (inUse.rows.length > 0) {
    throw new Error('Credential is in use by source(s)');
  }

  const result = await pool.query(
    'DELETE FROM source_credentials WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Test a credential by type. Returns success/failure with message. */
export async function testCredential(
  pool: Pool, id: string
): Promise<{ success: boolean; message: string }> {
  const cred = await pool.query<{ auth_type: string }>(
    'SELECT auth_type FROM source_credentials WHERE id = $1',
    [id]
  );
  if (cred.rows.length === 0) {
    return { success: false, message: 'Credential not found' };
  }

  const authType = cred.rows[0].auth_type;
  const value = await getCredentialValue(pool, id);

  if (authType === 'pat') {
    try {
      execSync(`git ls-remote https://x-access-token:${value}@github.com/ 2>&1`, {
        timeout: 10_000,
        stdio: 'pipe',
      });
      return { success: true, message: 'PAT authenticated successfully' };
    } catch {
      return { success: false, message: 'PAT authentication failed' };
    }
  }

  if (authType === 'ssh_key' || authType === 'deploy_key') {
    if (value.startsWith('-----BEGIN')) {
      return { success: true, message: 'SSH key format is valid' };
    }
    return { success: false, message: 'Invalid SSH key format — must start with -----BEGIN' };
  }

  return { success: false, message: `Unknown auth type: ${authType}` };
}

// ─── File State ─────────────────────────────────────────────────────────────

/** Get all file states for a source. */
export async function getFileStates(
  pool: Pool, sourceId: string
): Promise<SourceFileState[]> {
  const result = await pool.query<SourceFileState>(
    'SELECT * FROM source_file_state WHERE source_id = $1',
    [sourceId]
  );
  return result.rows;
}

/** Upsert a file state entry (insert or update on conflict). */
export async function upsertFileState(
  pool: Pool,
  sourceId: string,
  filePath: string,
  contentHash: string,
  chunkIds: string[]
): Promise<void> {
  await pool.query(`
    INSERT INTO source_file_state (source_id, file_path, content_hash, chunk_ids)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (source_id, file_path)
    DO UPDATE SET content_hash = EXCLUDED.content_hash,
                  chunk_ids = EXCLUDED.chunk_ids,
                  last_synced = NOW()
  `, [sourceId, filePath, contentHash, chunkIds]);
}

/** Delete file state entries for specific paths in a source. */
export async function deleteFileStates(
  pool: Pool, sourceId: string, filePaths: string[]
): Promise<void> {
  await pool.query(
    'DELETE FROM source_file_state WHERE source_id = $1 AND file_path = ANY($2)',
    [sourceId, filePaths]
  );
}

/** List files for a source with chunk count. */
export async function listSourceFiles(
  pool: Pool, sourceId: string
): Promise<Array<{
  file_path: string; content_hash: string;
  last_synced: string; chunk_count: number;
}>> {
  const result = await pool.query(`
    SELECT file_path, content_hash, last_synced,
           COALESCE(array_length(chunk_ids, 1), 0) as chunk_count
    FROM source_file_state
    WHERE source_id = $1
    ORDER BY file_path ASC
  `, [sourceId]);
  return result.rows;
}
