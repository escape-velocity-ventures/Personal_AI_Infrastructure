/**
 * Sync engine for Engram memory sources.
 *
 * Git clone -> file walk -> incremental diff -> chunk -> embed -> upsert.
 * Supports git_repo, local_path, and claude_memory source types.
 * Upload sources are one-shot and skipped.
 */

import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import type { MemorySource, SyncStats, ChunkStrategy } from './types';
import {
  getCredentialValue, updateSyncStatus,
  getFileStates, upsertFileState, deleteFileStates,
} from './sources';
import { chunkMarkdown } from './chunker';
import type { MemoryClient } from './client';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { mkdtemp, rm, readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import picomatch from 'picomatch';

export interface SyncOptions {
  force?: boolean; // ignore last_sync_hash, re-sync everything
}

const LOCK_TTL = 600; // 10 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively walk a directory, yielding relative file paths. */
async function* walkDir(dir: string, base?: string): AsyncGenerator<string> {
  const root = base ?? dir;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip .git directories explicitly
      if (entry.name === '.git') continue;
      yield* walkDir(fullPath, root);
    } else if (entry.isFile()) {
      // Yield path relative to root
      yield fullPath.slice(root.length + 1);
    }
  }
}

/** Build an authenticated git URL by injecting a PAT token. */
function authenticatedUrl(repoUrl: string, token: string): string {
  try {
    const url = new URL(repoUrl);
    url.username = 'x-access-token';
    url.password = token;
    return url.toString();
  } catch {
    // Fallback: simple string replacement for https:// URLs
    return repoUrl.replace('https://', `https://x-access-token:${token}@`);
  }
}

function emptySyncStats(): SyncStats {
  return {
    files_scanned: 0,
    files_changed: 0,
    files_added: 0,
    files_deleted: 0,
    chunks_created: 0,
    chunks_deleted: 0,
    duration_ms: 0,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function syncSource(
  pool: Pool,
  client: MemoryClient,
  redis: RedisClientType,
  source: MemorySource,
  opts?: SyncOptions,
): Promise<SyncStats> {
  const lockKey = `engram:sync:${source.id}`;
  const startMs = Date.now();

  // Upload sources are one-shot — nothing to sync
  if (source.source_type === 'upload') {
    return emptySyncStats();
  }

  // 1. Acquire Redis lock
  const acquired = await redis.set(lockKey, '1', { EX: LOCK_TTL, NX: true });
  if (!acquired) {
    throw new Error(`Sync already in progress for source: ${source.name}`);
  }

  let tempDir: string | undefined;

  try {
    // 2. Update status to syncing
    await updateSyncStatus(pool, source.id, 'syncing');

    // 3. Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), 'engram-sync-'));

    // 4. Resolve workDir and headSha based on source type
    let workDir: string;
    let headSha: string | undefined;

    if (source.source_type === 'git_repo') {
      // Build clone URL (optionally authenticated)
      let cloneUrl = source.repo_url ?? '';
      if (source.credential_id) {
        const token = await getCredentialValue(pool, source.credential_id);
        cloneUrl = authenticatedUrl(cloneUrl, token);
      }

      // Shallow clone
      const cloneResult = spawnSync('git', [
        'clone', '--depth', '1', '--branch', source.branch,
        cloneUrl, tempDir,
      ], { stdio: 'pipe', timeout: 120_000 });

      if (cloneResult.status !== 0) {
        const stderr = cloneResult.stderr?.toString() ?? '';
        throw new Error(`git clone failed: ${stderr}`);
      }

      // Get HEAD SHA
      const shaResult = spawnSync('git', ['-C', tempDir, 'rev-parse', 'HEAD'], {
        stdio: 'pipe',
      });
      headSha = shaResult.stdout?.toString().trim();

      // Short-circuit if HEAD hasn't changed (unless forced)
      if (headSha && headSha === source.last_sync_hash && !opts?.force) {
        await updateSyncStatus(pool, source.id, 'synced', { hash: headSha });
        return emptySyncStats();
      }

      // workDir is tempDir + base_path (if any)
      workDir = source.base_path
        ? join(tempDir, source.base_path)
        : tempDir;
    } else {
      // local_path or claude_memory — use base_path directly
      workDir = source.base_path || source.repo_url || '';
    }

    // Verify workDir exists
    const workDirStat = await stat(workDir).catch(() => null);
    if (!workDirStat?.isDirectory()) {
      throw new Error(`Working directory does not exist: ${workDir}`);
    }

    // 5. Walk files and filter with globs
    const isIncluded = picomatch(source.include_globs);
    const isExcluded = picomatch(source.exclude_globs);

    const currentFiles: string[] = [];
    for await (const relativePath of walkDir(workDir)) {
      if (isIncluded(relativePath) && !isExcluded(relativePath)) {
        currentFiles.push(relativePath);
      }
    }

    // 6. Load existing file states
    const existingStates = await getFileStates(pool, source.id);
    const existingMap = new Map(
      existingStates.map(s => [s.file_path, { contentHash: s.content_hash, chunkIds: s.chunk_ids }])
    );

    const stats = emptySyncStats();
    const currentFileSet = new Set(currentFiles);

    // 7. Process each file
    for (const relativePath of currentFiles) {
      stats.files_scanned++;

      const content = await readFile(join(workDir, relativePath), 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      const existing = existingMap.get(relativePath);

      // Skip if unchanged (unless forced)
      if (existing && existing.contentHash === hash && !opts?.force) {
        continue;
      }

      // Delete old chunks if this file was previously synced
      if (existing?.chunkIds?.length) {
        for (const chunkId of existing.chunkIds) {
          await pool.query('DELETE FROM memory_chunks WHERE id = $1', [chunkId]);
        }
        stats.chunks_deleted += existing.chunkIds.length;
      }

      // Chunk the content
      const chunks = chunkMarkdown(content, source.chunk_strategy as ChunkStrategy, {
        sourceFile: relativePath,
      });

      // Embed and store each chunk
      const newChunkIds: string[] = [];
      for (const chunk of chunks) {
        const tags = [
          ...source.default_tags,
          ...(chunk.metadata.heading ? [chunk.metadata.heading] : []),
        ];

        const chunkId = await client.remember(chunk.content, {
          tags,
          sourcePath: `${source.name}:${relativePath}`,
          sourceType: 'source-sync',
          tenantId: source.tenant_id,
        });
        newChunkIds.push(chunkId);
      }
      stats.chunks_created += newChunkIds.length;

      // Upsert file state
      await upsertFileState(pool, source.id, relativePath, hash, newChunkIds);

      if (existing) {
        stats.files_changed++;
      } else {
        stats.files_added++;
      }
    }

    // 8. Handle deleted files (in existing but not in current)
    for (const [filePath, fileState] of Array.from(existingMap.entries())) {
      if (!currentFileSet.has(filePath)) {
        // Delete chunks for removed file
        if (fileState.chunkIds?.length) {
          for (const chunkId of fileState.chunkIds) {
            await pool.query('DELETE FROM memory_chunks WHERE id = $1', [chunkId]);
          }
          stats.chunks_deleted += fileState.chunkIds.length;
        }
        stats.files_deleted++;
      }
    }

    // Delete file state entries for removed files
    const deletedPaths = Array.from(existingMap.keys()).filter(p => !currentFileSet.has(p));
    if (deletedPaths.length > 0) {
      await deleteFileStates(pool, source.id, deletedPaths);
    }

    // 9. Update source status
    stats.duration_ms = Date.now() - startMs;
    await updateSyncStatus(pool, source.id, 'synced', {
      hash: headSha,
      stats,
    });

    return stats;
  } catch (err: unknown) {
    // 11. Error handling
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus(pool, source.id, 'error', { error: message });
    throw err;
  } finally {
    // 10. Cleanup
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    await redis.del(lockKey);
  }
}
