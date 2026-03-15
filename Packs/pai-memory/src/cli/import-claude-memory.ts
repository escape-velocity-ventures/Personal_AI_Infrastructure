#!/usr/bin/env bun
/**
 * Import a Claude memory directory into Engram.
 *
 * Usage:
 *   bun run src/cli/import-claude-memory.ts [--path ~/.claude/projects/.../memory/] [--tags tag1,tag2] [--tenant TENANT]
 *
 * Default path: ~/.claude/projects/-Users-{username}/memory/
 */

import { parseArgs, getPool, getClient, getTenantId } from './helpers';
import { importClaudeMemory } from '../import';
import { join } from 'path';
import { homedir, userInfo } from 'os';

async function main() {
  const { flags } = parseArgs(process.argv);
  const tenantId = getTenantId(flags);
  const tags = flags.tags ? (flags.tags as string).split(',').map(t => t.trim()) : undefined;

  // Resolve memory directory path
  let memoryDir = flags.path as string;
  if (!memoryDir) {
    const username = userInfo().username;
    memoryDir = join(homedir(), '.claude', 'projects', `-Users-${username}`, 'memory');
  }

  console.log(`Importing Claude memory from: ${memoryDir}`);

  const pool = getPool();
  const client = await getClient();

  try {
    const result = await importClaudeMemory(pool, client, memoryDir, {
      tenant_id: tenantId,
      default_tags: tags,
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
