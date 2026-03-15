#!/usr/bin/env bun
/**
 * List memory sources for a tenant.
 *
 * Usage:
 *   bun run src/cli/source-list.ts [--tenant TENANT]
 */

import { parseArgs, getPool, getTenantId, formatTable } from './helpers';
import { listSources } from '../sources';

async function main() {
  const { flags } = parseArgs(process.argv);
  const tenantId = getTenantId(flags);

  const pool = getPool();
  try {
    const sources = await listSources(pool, tenantId);

    if (sources.length === 0) {
      console.log('No sources found.');
      return;
    }

    const rows = sources.map(s => ({
      name: s.name,
      type: s.source_type,
      status: s.sync_status,
      last_sync: s.last_sync_at ? new Date(s.last_sync_at).toISOString().slice(0, 19) : 'never',
      schedule: s.sync_schedule,
      enabled: s.sync_enabled ? 'yes' : 'no',
    }));

    console.log(formatTable(rows, ['name', 'type', 'status', 'last_sync', 'schedule', 'enabled']));
    console.log(`\n${sources.length} source(s)`);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
