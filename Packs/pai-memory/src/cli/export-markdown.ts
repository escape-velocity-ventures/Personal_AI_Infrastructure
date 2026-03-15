#!/usr/bin/env bun
/**
 * Export memory chunks as markdown files.
 *
 * Usage:
 *   bun run src/cli/export-markdown.ts [--tags tag1,tag2] [--source SOURCE_ID] [--output ./export/] [--tenant TENANT]
 */

import { parseArgs, getPool, getTenantId } from './helpers';
import { exportAsMarkdown } from '../export';
import type { ExportFilter } from '../types';

async function main() {
  const { flags } = parseArgs(process.argv);
  const tenantId = getTenantId(flags);
  const outputDir = (flags.output as string) || './export';

  const filter: ExportFilter = {
    tenant_ids: [tenantId],
  };

  if (flags.tags) {
    filter.tags = (flags.tags as string).split(',').map(t => t.trim());
  }
  if (flags.source) {
    filter.source_ids = [(flags.source as string)];
  }

  const pool = getPool();
  try {
    const result = await exportAsMarkdown(pool, filter, outputDir);
    console.log(`Exported ${result.chunks_exported} chunks to ${result.files_written} files in ${result.output_path}`);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
