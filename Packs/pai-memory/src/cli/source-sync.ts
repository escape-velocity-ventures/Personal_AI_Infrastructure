#!/usr/bin/env bun
/**
 * Sync one or all memory sources.
 *
 * Usage:
 *   bun run src/cli/source-sync.ts --name NAME [--force] [--tenant TENANT]
 *   bun run src/cli/source-sync.ts --all [--force] [--tenant TENANT]
 */

import { parseArgs, getPool, getClient, getTenantId } from './helpers';
import { listSources, getSource } from '../sources';
import { syncSource } from '../sync-engine';
import { createClient, type RedisClientType } from 'redis';
import type { MemorySource, SyncStats } from '../types';

function printStats(name: string, stats: SyncStats) {
  console.log(`\nSync complete: ${name}`);
  console.log(`  files scanned:  ${stats.files_scanned}`);
  console.log(`  files added:    ${stats.files_added}`);
  console.log(`  files changed:  ${stats.files_changed}`);
  console.log(`  files deleted:  ${stats.files_deleted}`);
  console.log(`  chunks created: ${stats.chunks_created}`);
  console.log(`  chunks deleted: ${stats.chunks_deleted}`);
  console.log(`  duration:       ${stats.duration_ms}ms`);
}

async function main() {
  const { flags } = parseArgs(process.argv);
  const tenantId = getTenantId(flags);
  const force = !!flags.force;

  if (!flags.name && !flags.all) {
    console.error('Usage: source-sync --name NAME [--force] [--tenant TENANT]');
    console.error('       source-sync --all [--force] [--tenant TENANT]');
    process.exit(1);
  }

  const pool = getPool();
  const client = await getClient();
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redis.connect();

  try {
    let sources: MemorySource[];

    if (flags.all) {
      sources = await listSources(pool, tenantId);
      if (sources.length === 0) {
        console.log('No sources found for this tenant.');
        return;
      }
      console.log(`Syncing ${sources.length} source(s)...`);
    } else {
      const source = await getSource(pool, flags.name as string, tenantId);
      if (!source) {
        console.error(`Error: source '${flags.name}' not found`);
        process.exit(1);
      }
      sources = [source];
    }

    for (const source of sources) {
      try {
        console.log(`Syncing '${source.name}' (${source.source_type})...`);
        const stats = await syncSource(pool, client, redis as RedisClientType, source, { force });
        printStats(source.name, stats);
      } catch (err) {
        console.error(`Error syncing '${source.name}':`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await redis.disconnect();
    await client.disconnect();
    await pool.end();
  }
}

main();
