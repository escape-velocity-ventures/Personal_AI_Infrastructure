#!/usr/bin/env bun
/**
 * Export memory chunks as JSON.
 *
 * Usage:
 *   bun run src/cli/export-json.ts [--tags tag1,tag2] [--source SOURCE_ID] [--output ./export.json] [--tenant TENANT]
 *
 * If --output is omitted, writes to stdout.
 */

import { parseArgs, getPool, getTenantId } from './helpers';
import { exportAsJson } from '../export';
import { writeFile } from 'fs/promises';
import type { ExportFilter } from '../types';

async function main() {
  const { flags } = parseArgs(process.argv);
  const tenantId = getTenantId(flags);
  const outputPath = flags.output as string | undefined;

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
    const result = await exportAsJson(pool, filter);
    const json = JSON.stringify(result, null, 2);

    if (outputPath) {
      await writeFile(outputPath, json, 'utf-8');
      console.log(`Exported ${result.metadata.count} chunks to ${outputPath}`);
    } else {
      process.stdout.write(json + '\n');
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
