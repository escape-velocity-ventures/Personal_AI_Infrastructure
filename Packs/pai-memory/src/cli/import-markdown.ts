#!/usr/bin/env bun
/**
 * Import markdown files into Engram memory.
 *
 * Usage:
 *   bun run src/cli/import-markdown.ts --files "path/to/*.md" [--tags tag1,tag2] [--strategy heading|paragraph|fixed_size] [--tenant TENANT]
 */

import { parseArgs, getPool, getClient, getTenantId } from './helpers';
import { importMarkdownFiles } from '../import';
import { Glob } from 'bun';
import type { ChunkStrategy } from '../types';

async function main() {
  const { flags } = parseArgs(process.argv);

  const pattern = flags.files as string;
  if (!pattern) {
    console.error('Usage: import-markdown --files "path/to/*.md" [--tags tag1,tag2] [--strategy heading|paragraph|fixed_size] [--tenant TENANT]');
    process.exit(1);
  }

  const tenantId = getTenantId(flags);
  const tags = flags.tags ? (flags.tags as string).split(',').map(t => t.trim()) : undefined;
  const strategy = (flags.strategy as ChunkStrategy) || undefined;

  // Expand glob pattern
  const glob = new Glob(pattern);
  const files: string[] = [];
  for await (const file of glob.scan({ absolute: true })) {
    files.push(file);
  }

  if (files.length === 0) {
    console.error(`No files matched pattern: ${pattern}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} file(s) matching '${pattern}'`);

  const pool = getPool();
  const client = await getClient();

  try {
    const result = await importMarkdownFiles(pool, client, files, {
      tenant_id: tenantId,
      default_tags: tags,
      chunk_strategy: strategy,
    });

    console.log(`\nImport complete:`);
    console.log(`  files processed: ${result.files_processed}`);
    console.log(`  chunks created:  ${result.chunks_created}`);
    console.log(`  chunks skipped:  ${result.chunks_skipped}`);
    if (result.errors.length > 0) {
      console.log(`  errors:          ${result.errors.length}`);
      for (const err of result.errors) {
        console.log(`    - ${err.file}: ${err.error}`);
      }
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
