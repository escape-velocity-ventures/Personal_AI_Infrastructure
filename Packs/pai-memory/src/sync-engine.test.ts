import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { syncSource } from './sync-engine';
import type { MemorySource } from './types';

// ── Mocks ─────────────────────────────────────────────────────────

function makeSource(overrides: Partial<MemorySource> = {}): MemorySource {
  return {
    id: 'src-001',
    tenant_id: 'tenant-001',
    name: 'test-source',
    source_type: 'local_path',
    branch: 'main',
    base_path: '/tmp/test-sync-repo',
    include_globs: ['**/*.md'],
    exclude_globs: ['**/node_modules/**'],
    sync_schedule: 'manual',
    sync_enabled: true,
    chunk_strategy: 'heading',
    default_tags: ['test'],
    last_sync_stats: {},
    sync_status: 'pending',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Minimal mock pool that routes by SQL prefix
function makePool(queryResults: Record<string, { rows: unknown[] }> = {}) {
  const defaultResults: Record<string, { rows: unknown[] }> = {
    'UPDATE memory_sources': { rows: [] },
    'SELECT * FROM source_file_state': { rows: [] },
    'INSERT INTO source_file_state': { rows: [] },
    'DELETE FROM source_file_state': { rows: [] },
    'DELETE FROM memory_chunks': { rows: [] },
  };
  const merged = { ...defaultResults, ...queryResults };

  return {
    query: mock((sql: string) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim();
      for (const [prefix, result] of Object.entries(merged)) {
        if (trimmed.startsWith(prefix)) return Promise.resolve(result);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  } as any;
}

// Minimal mock MemoryClient
function makeClient() {
  let counter = 0;
  return {
    remember: mock(async () => `chunk-${counter++}`),
    forget: mock(async () => true),
  } as any;
}

// Minimal mock Redis — uses the native set(key, val, { NX, EX }) pattern
function makeRedis() {
  const store = new Map<string, string>();
  return {
    set: mock(async (key: string, val: string, opts?: { NX?: boolean; EX?: number }) => {
      if (opts?.NX && store.has(key)) return null; // lock already held
      store.set(key, val);
      return 'OK';
    }),
    get: mock(async (key: string) => store.get(key) ?? null),
    del: mock(async (key: string) => { store.delete(key); return 1; }),
    _store: store,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('syncSource', () => {
  let pool: ReturnType<typeof makePool>;
  let client: ReturnType<typeof makeClient>;
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    pool = makePool();
    client = makeClient();
    redis = makeRedis();
  });

  it('returns empty stats for upload source type', async () => {
    const source = makeSource({ source_type: 'upload' });
    const stats = await syncSource(pool, client, redis, source);
    expect(stats.files_scanned).toBe(0);
    expect(stats.chunks_created).toBe(0);
  });

  it('acquires and releases Redis lock', async () => {
    // Use a local_path source that points to a real temp dir
    const { mkdtemp } = await import('fs/promises');
    const os = await import('os');
    const { join } = await import('path');
    const tmp = await mkdtemp(join(os.default.tmpdir(), 'sync-lock-'));
    const source = makeSource({ base_path: tmp, include_globs: [] });
    await syncSource(pool, client, redis, source);
    // Lock should be acquired (set called) then released (del called)
    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });

  it('throws when lock is already held', async () => {
    const source = makeSource();
    // Pre-set the lock
    redis._store.set(`engram:sync:${source.id}`, '1');
    await expect(syncSource(pool, client, redis, source))
      .rejects.toThrow(/[Ss]ync already in progress/);
  });

  it('updates status to syncing on start', async () => {
    const { mkdtemp } = await import('fs/promises');
    const os = await import('os');
    const { join } = await import('path');
    const tmp = await mkdtemp(join(os.default.tmpdir(), 'sync-status-'));
    const source = makeSource({ base_path: tmp, include_globs: [] });
    await syncSource(pool, client, redis, source);
    // Should have called UPDATE memory_sources at least twice (syncing + synced)
    const updateCalls = pool.query.mock.calls.filter(
      (c: any) => typeof c[0] === 'string' && c[0].replace(/\s+/g, ' ').includes('UPDATE memory_sources')
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('updates status to error on failure and releases lock', async () => {
    const source = makeSource({ base_path: '/nonexistent/path/that/does/not/exist' });
    try {
      await syncSource(pool, client, redis, source);
    } catch {
      // Expected to throw
    }
    // Lock should always be released
    expect(redis.del).toHaveBeenCalled();
    // Status should have been set to error
    const errorCalls = pool.query.mock.calls.filter(
      (c: any) => {
        if (typeof c[0] !== 'string') return false;
        const sql = c[0].replace(/\s+/g, ' ');
        return sql.includes('UPDATE memory_sources') && Array.isArray(c[1]) && c[1].includes('error');
      }
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('syncSource with local files', () => {
  let pool: ReturnType<typeof makePool>;
  let client: ReturnType<typeof makeClient>;
  let redis: ReturnType<typeof makeRedis>;
  let tmpDir: string;

  beforeEach(async () => {
    pool = makePool();
    client = makeClient();
    redis = makeRedis();

    // Create a temp directory with test files
    const { mkdtemp, writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');
    const os = await import('os');
    tmpDir = await mkdtemp(join(os.default.tmpdir(), 'engram-sync-test-'));
    await writeFile(join(tmpDir, 'readme.md'), '## Introduction\nHello world\n\n## Details\nSome details');
    await mkdir(join(tmpDir, 'docs'));
    await writeFile(join(tmpDir, 'docs', 'guide.md'), '## Guide\nStep one\n\n## Advanced\nStep two');
    await writeFile(join(tmpDir, 'skip.txt'), 'Not a markdown file');
  });

  it('scans and chunks markdown files', async () => {
    const source = makeSource({ base_path: tmpDir });
    const stats = await syncSource(pool, client, redis, source);
    expect(stats.files_scanned).toBeGreaterThanOrEqual(2);
    expect(stats.chunks_created).toBeGreaterThan(0);
    expect(client.remember.mock.calls.length).toBeGreaterThan(0);
  });

  it('respects include_globs filter', async () => {
    const source = makeSource({ base_path: tmpDir, include_globs: ['**/*.md'] });
    const stats = await syncSource(pool, client, redis, source);
    expect(stats.files_scanned).toBe(2);
  });

  it('respects exclude_globs filter', async () => {
    const source = makeSource({
      base_path: tmpDir,
      include_globs: ['**/*'],
      exclude_globs: ['**/docs/**'],
    });
    const stats = await syncSource(pool, client, redis, source);
    // Should exclude docs/ directory, leaving readme.md + skip.txt
    expect(stats.files_scanned).toBeLessThanOrEqual(2);
  });

  it('tracks files_added correctly', async () => {
    const source = makeSource({ base_path: tmpDir });
    const stats = await syncSource(pool, client, redis, source);
    // All files are new on first sync
    expect(stats.files_added).toBe(stats.files_scanned);
    expect(stats.files_changed).toBe(0);
  });

  it('handles force sync', async () => {
    const source = makeSource({ base_path: tmpDir });
    const stats = await syncSource(pool, client, redis, source, { force: true });
    expect(stats.files_scanned).toBeGreaterThan(0);
    expect(stats.chunks_created).toBeGreaterThan(0);
  });

  it('detects deleted files', async () => {
    const existingStates = [
      {
        source_id: 'src-001',
        file_path: 'old-file-gone.md',
        content_hash: 'abc123',
        chunk_ids: ['chunk-old-1', 'chunk-old-2'],
        last_synced: '2026-01-01T00:00:00Z',
      },
    ];
    pool = makePool({
      'SELECT * FROM source_file_state': { rows: existingStates },
    });

    const source = makeSource({ base_path: tmpDir });
    const stats = await syncSource(pool, client, redis, source);
    expect(stats.files_deleted).toBe(1);
    expect(stats.chunks_deleted).toBeGreaterThanOrEqual(2);
  });
});
