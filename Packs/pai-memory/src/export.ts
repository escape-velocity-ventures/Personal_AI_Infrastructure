/**
 * Export pipeline for Engram memory data.
 *
 * Supports markdown, JSON, and streaming exports with flexible filtering.
 * All functions take a pg Pool as first argument for standalone use.
 * No ORM — parameterized queries only.
 */

import type { Pool } from 'pg';
import type { ExportFilter, MemoryChunk } from './types';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ExportResult {
  chunks_exported: number;
  files_written?: number;
  output_path?: string;
}

// ─── Column select helpers ──────────────────────────────────────────────────

const BASE_COLUMNS = `
  id, content, source_path as "sourcePath", source_type as "sourceType",
  memory_type as "memoryType", tags, agent_id as "agentId",
  visibility, decay_class as "decayClass", expires_at as "expiresAt",
  session_id as "sessionId", created_at as "createdAt",
  tenant_id as "tenantId", author_id as "authorId", scope`;

const COLUMNS_WITH_EMBEDDING = `${BASE_COLUMNS}, embedding`;

// ─── Query Builder ──────────────────────────────────────────────────────────

/** Build a filtered query for memory chunks based on ExportFilter. */
export async function queryChunksForExport(
  pool: Pool,
  filter: ExportFilter,
): Promise<MemoryChunk[]> {
  const columns = filter.include_embeddings ? COLUMNS_WITH_EMBEDDING : BASE_COLUMNS;
  let sql = `SELECT ${columns} FROM memory_chunks WHERE 1=1`;
  const params: unknown[] = [];
  let idx = 0;

  if (filter.tenant_ids?.length) {
    idx++;
    sql += ` AND tenant_id = ANY($${idx})`;
    params.push(filter.tenant_ids);
  }

  if (filter.tags?.length) {
    idx++;
    sql += ` AND tags && $${idx}`;
    params.push(filter.tags);
  }

  if (filter.memory_types?.length) {
    idx++;
    sql += ` AND memory_type = ANY($${idx})`;
    params.push(filter.memory_types);
  }

  if (filter.date_from) {
    idx++;
    sql += ` AND created_at >= $${idx}`;
    params.push(filter.date_from);
  }

  if (filter.date_to) {
    idx++;
    sql += ` AND created_at <= $${idx}`;
    params.push(filter.date_to);
  }

  if (filter.scopes?.length) {
    idx++;
    sql += ` AND scope = ANY($${idx})`;
    params.push(filter.scopes);
  }

  if (filter.source_ids?.length) {
    idx++;
    sql += ` AND id = ANY(SELECT unnest(chunk_ids) FROM source_file_state WHERE source_id = ANY($${idx}))`;
    params.push(filter.source_ids);
  }

  if (filter.entity_names?.length) {
    idx++;
    sql += ` AND id IN (SELECT chunk_id FROM chunk_entity_refs cer JOIN entities e ON cer.entity_id = e.id WHERE e.name = ANY($${idx}))`;
    params.push(filter.entity_names);
  }

  sql += ' ORDER BY created_at DESC';

  const result = await pool.query<MemoryChunk>(sql, params);
  return result.rows;
}

// ─── Markdown Export ────────────────────────────────────────────────────────

/** Sanitize a string for use as a filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .substring(0, 200);
}

/** Export memory chunks as markdown files grouped by source. */
export async function exportAsMarkdown(
  pool: Pool,
  filter: ExportFilter,
  outputDir: string,
): Promise<ExportResult> {
  const chunks = await queryChunksForExport(pool, filter);

  // Group chunks by source
  const groups = new Map<string, MemoryChunk[]>();
  for (const chunk of chunks) {
    const source = chunk.sourcePath ?? 'unsorted';
    const existing = groups.get(source);
    if (existing) {
      existing.push(chunk);
    } else {
      groups.set(source, [chunk]);
    }
  }

  await mkdir(outputDir, { recursive: true });

  let filesWritten = 0;
  for (const [source, sourceChunks] of groups) {
    const filename = sanitizeFilename(source) + '.md';
    let content = `# ${source}\n`;

    for (const chunk of sourceChunks) {
      const heading = chunk.tags?.[0] ?? 'Memory';
      const created = chunk.createdAt instanceof Date
        ? chunk.createdAt.toISOString()
        : chunk.createdAt;
      content += `\n## ${heading}\n\n`;
      content += `${chunk.content}\n\n`;
      content += `<!-- metadata: type=${chunk.memoryType}, scope=${chunk.scope ?? 'unknown'}, created=${created} -->\n\n`;
      content += `---\n`;
    }

    await writeFile(join(outputDir, filename), content, 'utf-8');
    filesWritten++;
  }

  return {
    chunks_exported: chunks.length,
    files_written: filesWritten,
    output_path: outputDir,
  };
}

// ─── JSON Export ────────────────────────────────────────────────────────────

/** Export memory chunks as structured JSON with metadata envelope. */
export async function exportAsJson(
  pool: Pool,
  filter: ExportFilter,
): Promise<{
  chunks: Record<string, unknown>[];
  metadata: { exported_at: string; filter: ExportFilter; count: number };
}> {
  const chunks = await queryChunksForExport(pool, filter);

  // Strip embeddings unless explicitly requested
  const cleaned = chunks.map((chunk) => {
    const { ...rest } = chunk as Record<string, unknown>;
    if (!filter.include_embeddings) {
      delete rest.embedding;
    }
    return rest;
  });

  return {
    chunks: cleaned,
    metadata: {
      exported_at: new Date().toISOString(),
      filter,
      count: chunks.length,
    },
  };
}

// ─── Streaming Export ───────────────────────────────────────────────────────

const STREAM_BATCH_SIZE = 100;

/** Cursor-based streaming export for large datasets. Yields one chunk at a time. */
export async function* exportAsStream(
  pool: Pool,
  filter: ExportFilter,
): AsyncGenerator<MemoryChunk> {
  const columns = filter.include_embeddings ? COLUMNS_WITH_EMBEDDING : BASE_COLUMNS;
  let baseSql = `SELECT ${columns} FROM memory_chunks WHERE 1=1`;
  const params: unknown[] = [];
  let idx = 0;

  if (filter.tenant_ids?.length) {
    idx++;
    baseSql += ` AND tenant_id = ANY($${idx})`;
    params.push(filter.tenant_ids);
  }

  if (filter.tags?.length) {
    idx++;
    baseSql += ` AND tags && $${idx}`;
    params.push(filter.tags);
  }

  if (filter.memory_types?.length) {
    idx++;
    baseSql += ` AND memory_type = ANY($${idx})`;
    params.push(filter.memory_types);
  }

  if (filter.date_from) {
    idx++;
    baseSql += ` AND created_at >= $${idx}`;
    params.push(filter.date_from);
  }

  if (filter.date_to) {
    idx++;
    baseSql += ` AND created_at <= $${idx}`;
    params.push(filter.date_to);
  }

  if (filter.scopes?.length) {
    idx++;
    baseSql += ` AND scope = ANY($${idx})`;
    params.push(filter.scopes);
  }

  if (filter.source_ids?.length) {
    idx++;
    baseSql += ` AND id = ANY(SELECT unnest(chunk_ids) FROM source_file_state WHERE source_id = ANY($${idx}))`;
    params.push(filter.source_ids);
  }

  if (filter.entity_names?.length) {
    idx++;
    baseSql += ` AND id IN (SELECT chunk_id FROM chunk_entity_refs cer JOIN entities e ON cer.entity_id = e.id WHERE e.name = ANY($${idx}))`;
    params.push(filter.entity_names);
  }

  baseSql += ' ORDER BY created_at DESC';

  let offset = 0;
  while (true) {
    const limitIdx = idx + 1;
    const offsetIdx = idx + 2;
    const sql = `${baseSql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const result = await pool.query<MemoryChunk>(sql, [
      ...params,
      STREAM_BATCH_SIZE,
      offset,
    ]);

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      yield row;
    }

    if (result.rows.length < STREAM_BATCH_SIZE) break;
    offset += STREAM_BATCH_SIZE;
  }
}
