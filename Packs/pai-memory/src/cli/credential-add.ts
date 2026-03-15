#!/usr/bin/env bun
/**
 * Add a credential for source authentication.
 *
 * Usage:
 *   bun run src/cli/credential-add.ts --name NAME --type pat|ssh_key|deploy_key [--provider github|gitea|gitlab] [--value TOKEN] [--tenant TENANT]
 *
 * If --value is omitted and stdin is not a TTY, reads the token from stdin (for piping).
 */

import { parseArgs, getPool, getTenantId } from './helpers';
import { createCredential } from '../sources';

async function main() {
  const { flags } = parseArgs(process.argv);

  const name = flags.name as string;
  const authType = flags.type as string;

  if (!name || !authType) {
    console.error('Usage: credential-add --name NAME --type pat|ssh_key|deploy_key [--provider github|gitea|gitlab] [--value TOKEN] [--tenant TENANT]');
    process.exit(1);
  }

  if (!['pat', 'ssh_key', 'deploy_key'].includes(authType)) {
    console.error(`Error: --type must be one of: pat, ssh_key, deploy_key (got: ${authType})`);
    process.exit(1);
  }

  const tenantId = getTenantId(flags);
  const provider = (flags.provider as string) || undefined;

  // Read value from --value flag or stdin
  let value = flags.value as string | undefined;
  if (!value && typeof value !== 'string') {
    const isTTY = process.stdin.isTTY;
    if (!isTTY) {
      // Read from stdin (piped input)
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      value = Buffer.concat(chunks).toString('utf-8').trim();
    }
  }

  if (!value) {
    console.error('Error: provide --value TOKEN or pipe the token via stdin');
    process.exit(1);
  }

  const pool = getPool();
  try {
    const result = await createCredential(pool, {
      tenant_id: tenantId,
      name,
      auth_type: authType as 'pat' | 'ssh_key' | 'deploy_key',
      provider: provider as 'github' | 'gitea' | 'gitlab' | undefined,
      value,
    });
    console.log(`Credential '${result.name}' created (id: ${result.id})`);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
