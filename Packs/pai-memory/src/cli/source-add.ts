#!/usr/bin/env bun
/**
 * Add a memory source.
 *
 * Usage:
 *   bun run src/cli/source-add.ts --name NAME --type git_repo|local_path|claude_memory \
 *     [--url URL] [--path PATH] [--branch main] [--credential CRED_NAME] \
 *     [--include "**\/*.md"] [--exclude "node_modules/**"] \
 *     [--schedule manual|hourly|daily|weekly] [--tags tag1,tag2] \
 *     [--strategy heading|paragraph|fixed_size] [--tenant TENANT]
 */

import { parseArgs, getPool, getTenantId, formatTable } from './helpers';
import { createSource, listCredentials } from '../sources';
import type { SourceType, SyncSchedule, ChunkStrategy } from '../types';

async function main() {
  const { flags } = parseArgs(process.argv);

  const name = flags.name as string;
  const sourceType = flags.type as string;

  if (!name || !sourceType) {
    console.error('Usage: source-add --name NAME --type git_repo|local_path|claude_memory [options]');
    process.exit(1);
  }

  if (!['git_repo', 'local_path', 'upload', 'claude_memory'].includes(sourceType)) {
    console.error(`Error: --type must be one of: git_repo, local_path, claude_memory (got: ${sourceType})`);
    process.exit(1);
  }

  const tenantId = getTenantId(flags);
  const pool = getPool();

  try {
    // Resolve credential by name if provided
    let credentialId: string | undefined;
    if (flags.credential) {
      const creds = await listCredentials(pool, tenantId);
      const match = creds.find(c => c.name === flags.credential);
      if (!match) {
        console.error(`Error: credential '${flags.credential}' not found for this tenant`);
        process.exit(1);
      }
      credentialId = match.id;
    }

    const tags = flags.tags ? (flags.tags as string).split(',').map(t => t.trim()) : undefined;
    const includeGlobs = flags.include ? (flags.include as string).split(',').map(g => g.trim()) : undefined;
    const excludeGlobs = flags.exclude ? (flags.exclude as string).split(',').map(g => g.trim()) : undefined;

    const source = await createSource(pool, {
      tenant_id: tenantId,
      name,
      source_type: sourceType as SourceType,
      repo_url: (flags.url as string) || undefined,
      branch: (flags.branch as string) || undefined,
      base_path: (flags.path as string) || undefined,
      include_globs: includeGlobs,
      exclude_globs: excludeGlobs,
      credential_id: credentialId,
      sync_schedule: (flags.schedule as SyncSchedule) || undefined,
      chunk_strategy: (flags.strategy as ChunkStrategy) || undefined,
      default_tags: tags,
    });

    console.log(`Source '${source.name}' created (id: ${source.id})`);
    console.log(`  type:     ${source.source_type}`);
    console.log(`  branch:   ${source.branch}`);
    console.log(`  schedule: ${source.sync_schedule}`);
    console.log(`  strategy: ${source.chunk_strategy}`);
    if (source.repo_url) console.log(`  url:      ${source.repo_url}`);
    if (source.base_path) console.log(`  path:     ${source.base_path}`);
    if (source.default_tags.length) console.log(`  tags:     ${source.default_tags.join(', ')}`);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
