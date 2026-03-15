import { Pool } from 'pg';
import { MemoryClient } from '../client';

export function parseArgs(argv: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const args = argv.slice(2); // skip bun and script path

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

export function getPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/pai_memory' });
}

export async function getClient(): Promise<MemoryClient> {
  const client = new MemoryClient({
    pgUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/pai_memory',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  });
  await client.connect();
  return client;
}

export function getTenantId(flags: Record<string, string | boolean>): string {
  const tenantId = (flags.tenant as string) || process.env.ENGRAM_TENANT_ID;
  if (!tenantId) {
    console.error('Error: --tenant or ENGRAM_TENANT_ID required');
    process.exit(1);
  }
  return tenantId;
}

export function formatTable(rows: Record<string, any>[], columns: string[]): string {
  if (rows.length === 0) return '(no results)';
  const widths = columns.map(col => Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)));
  const header = columns.map((col, i) => col.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  const body = rows.map(row => columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join('  '));
  return [header, sep, ...body].join('\n');
}
