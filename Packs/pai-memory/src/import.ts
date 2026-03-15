/**
 * Import pipeline for Engram memory data.
 *
 * Supports markdown files, JSON chunks, and Claude memory directories.
 * All functions take a pg Pool as first argument for standalone use.
 * No ORM — parameterized queries only.
 */

import type { Pool } from 'pg';
import type { ImportOptions, MemoryType, Scope } from './types';
import { chunkMarkdown } from './chunker';
import type { MemoryClient } from './client';
import { readdir, readFile } from 'fs/promises';
import { join, basename, extname } from 'path';

export interface ImportResult {
  files_processed: number;
  chunks_created: number;
  chunks_skipped: number;
  errors: Array<{ file: string; error: string }>;
}

interface JsonImportData {
  content: string;
  tags?: string[];
  memory_type?: MemoryType;
  source?: string;
  metadata?: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function emptyResult(): ImportResult {
  return { files_processed: 0, chunks_created: 0, chunks_skipped: 0, errors: [] };
}

/** Check if content already exists for a given tenant. */
async function isDuplicate(pool: Pool, content: string, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM memory_chunks WHERE content = $1 AND tenant_id = $2 LIMIT 1',
    [content, tenantId],
  );
  return result.rows.length > 0;
}

/** Recursively collect all .md files under a directory. */
async function collectMdFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMdFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(fullPath);
    }
  }

  return files;
}

// ─── Markdown Import ───────────────────────────────────────────────────────

/** Import markdown files: chunk, dedup, and store via MemoryClient. */
export async function importMarkdownFiles(
  pool: Pool,
  client: MemoryClient,
  files: string[],
  opts: ImportOptions,
): Promise<ImportResult> {
  const result = emptyResult();

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const strategy = opts.chunk_strategy ?? 'heading';
      const chunks = chunkMarkdown(content, strategy, { sourceFile: basename(filePath) });

      for (const chunk of chunks) {
        if (await isDuplicate(pool, chunk.content, opts.tenant_id)) {
          result.chunks_skipped++;
          continue;
        }

        const tags = [
          ...(opts.default_tags ?? []),
          ...(chunk.metadata.heading ? [chunk.metadata.heading] : []),
        ];

        await client.remember(chunk.content, {
          tags,
          tenantId: opts.tenant_id,
          sourcePath: basename(filePath),
          sourceType: 'agent',
          memoryType: 'semantic',
          scope: opts.scope ?? 'org',
        });

        result.chunks_created++;
      }

      result.files_processed++;
    } catch (err) {
      result.errors.push({
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(
    `Imported ${result.files_processed} files: ${result.chunks_created} chunks created, ${result.chunks_skipped} skipped`,
  );

  return result;
}

// ─── JSON Import ───────────────────────────────────────────────────────────

/** Import structured JSON chunks: dedup and store via MemoryClient. */
export async function importJsonChunks(
  pool: Pool,
  client: MemoryClient,
  data: JsonImportData[],
  opts: ImportOptions,
): Promise<ImportResult> {
  const result = emptyResult();

  for (const item of data) {
    try {
      if (await isDuplicate(pool, item.content, opts.tenant_id)) {
        result.chunks_skipped++;
        continue;
      }

      const tags = [
        ...(opts.default_tags ?? []),
        ...(item.tags ?? []),
      ];

      await client.remember(item.content, {
        tags,
        tenantId: opts.tenant_id,
        memoryType: item.memory_type ?? 'semantic',
        sourcePath: item.source ?? opts.source_name ?? 'json-import',
        sourceType: 'agent',
        scope: opts.scope ?? 'org',
      });

      result.chunks_created++;
    } catch (err) {
      result.errors.push({
        file: item.source ?? 'json-item',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.files_processed = 1;

  console.log(
    `Imported JSON: ${result.chunks_created} chunks created, ${result.chunks_skipped} skipped`,
  );

  return result;
}

// ─── Claude Memory Import ──────────────────────────────────────────────────

/**
 * Import a Claude memory directory (e.g. ~/.claude/memory/).
 * MEMORY.md gets heading-based chunking; other .md files become single chunks.
 */
export async function importClaudeMemory(
  pool: Pool,
  client: MemoryClient,
  memoryDir: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const allFiles = await collectMdFiles(memoryDir);

  if (allFiles.length === 0) {
    console.log(`No .md files found in ${memoryDir}`);
    return emptyResult();
  }

  // MEMORY.md uses heading strategy; everything else is one chunk per file
  const memoryMdFiles: string[] = [];
  const topicFiles: string[] = [];

  for (const f of allFiles) {
    if (basename(f).toUpperCase() === 'MEMORY.MD') {
      memoryMdFiles.push(f);
    } else {
      topicFiles.push(f);
    }
  }

  const mergedOpts: ImportOptions = {
    ...opts,
    default_tags: [...(opts.default_tags ?? []), 'claude-memory'],
  };

  // Import MEMORY.md with heading strategy
  const headingOpts: ImportOptions = { ...mergedOpts, chunk_strategy: 'heading' };
  const memoryResult = memoryMdFiles.length > 0
    ? await importMarkdownFiles(pool, client, memoryMdFiles, headingOpts)
    : emptyResult();

  // Import topic files: each file = one chunk (use 'fixed_size' with large max to keep whole)
  const topicOpts: ImportOptions = { ...mergedOpts, chunk_strategy: 'paragraph' };
  const topicResult = topicFiles.length > 0
    ? await importMarkdownFiles(pool, client, topicFiles, topicOpts)
    : emptyResult();

  const combined: ImportResult = {
    files_processed: memoryResult.files_processed + topicResult.files_processed,
    chunks_created: memoryResult.chunks_created + topicResult.chunks_created,
    chunks_skipped: memoryResult.chunks_skipped + topicResult.chunks_skipped,
    errors: [...memoryResult.errors, ...topicResult.errors],
  };

  console.log(
    `Claude memory import: ${combined.files_processed} files, ${combined.chunks_created} chunks created, ${combined.chunks_skipped} skipped`,
  );

  return combined;
}
