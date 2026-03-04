#!/usr/bin/env bun
/**
 * Session JSONL Ingester
 *
 * Parses Claude Code .jsonl session files and populates command_log.
 * Captures tool calls, their results, surrounding reasoning, and user prompt context.
 *
 * Usage:
 *   bun run ingest-sessions.ts [--dir ~/.claude/projects] [--machine plato] [--agent main] [--dry-run]
 *
 * Designed to run on any machine and ship logs to the shared pgvector DB.
 * Safe to re-run — skips already-ingested sessions via ingestion_sources.
 */

import { Pool } from 'pg';
import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';

// ─── Config ─────────────────────────────────────────────────────────────────

const PG_URL = 'postgresql://memory:memory-ev-2026@192.168.4.124:5432/memory';
const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_PROJECTS_DIR = `${process.env.HOME}/.claude/projects`;

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const dryRun = args.includes('--dry-run');
const singleFile = args.find(a => a.startsWith('--file='))?.split('=')[1];
const projectsDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] ?? DEFAULT_PROJECTS_DIR;
const machineId = args.find(a => a.startsWith('--machine='))?.split('=')[1] ?? process.env.HOSTNAME ?? 'unknown';
const agentId = args.find(a => a.startsWith('--agent='))?.split('=')[1] ?? 'main';

// ─── JSONL Types ─────────────────────────────────────────────────────────────

interface JEntry {
  type: 'assistant' | 'user' | 'system' | 'progress' | 'file-history-snapshot' | 'queue-operation';
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  uuid?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  id?: string;
  tool_use_id?: string;
  name?: string;
  input?: Record<string, string>;
  text?: string;
  content?: string | ContentBlock[];
  isError?: boolean;
}

interface ParsedCommand {
  sessionId: string;
  ts: string;
  cwd: string;
  gitBranch?: string;
  toolName: string;
  commandText: string;
  description?: string;
  toolUseId: string;
  userPrompt?: string;
  reasoning?: string;
  outcome?: 'success' | 'error' | 'blocked' | 'unknown';
  resultText?: string;
  exitCode?: number;
}

// ─── Embedding ───────────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, 4000) }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  } catch {
    return null;
  }
}

// ─── JSONL Parser ─────────────────────────────────────────────────────────────

function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join(' ')
    .trim();
}

function parseSession(lines: string[], filePath: string): ParsedCommand[] {
  const entries: JEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  // Build lookup: tool_use_id → result
  const resultsByToolUseId = new Map<string, { outcome: string; resultText: string; exitCode?: number }>();
  for (const entry of entries) {
    if (entry.type !== 'user') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      const raw = typeof block.content === 'string'
        ? block.content
        : extractText(block.content as ContentBlock[]);

      // Parse exit code if present
      const exitMatch = raw.match(/Exit code: (\d+)/);
      const exitCode = exitMatch ? parseInt(exitMatch[1]) : undefined;

      // Blocked by hook
      const blocked = raw.includes('hook error') || raw.includes('BLOCKED');

      resultsByToolUseId.set(block.tool_use_id, {
        outcome: block.isError ? 'error' : blocked ? 'blocked' : 'success',
        resultText: raw.slice(0, 2000),
        exitCode,
      });
    }
  }

  // Find last user text message (for user_prompt context per assistant block)
  const commands: ParsedCommand[] = [];
  let lastUserPrompt: string | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Track last user text message
    if (entry.type === 'user') {
      const content = entry.message?.content;
      const userText = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter(b => b.type === 'text').map(b => b.text ?? '').join(' ').trim()
          : '';
      if (userText) lastUserPrompt = userText.slice(0, 500);
    }

    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    // Extract reasoning: text blocks before tool calls
    const textBeforeTools = content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join(' ')
      .trim()
      .slice(0, 1000);

    // Extract each tool_use in this assistant message
    for (const block of content) {
      if (block.type !== 'tool_use' || !block.id || !block.name) continue;

      const input = block.input ?? {};
      const commandText = input.command ?? input.pattern ?? input.file_path ?? input.path ?? input.prompt ?? JSON.stringify(input);
      const description = input.description ?? undefined;

      const result = resultsByToolUseId.get(block.id);

      commands.push({
        sessionId: entry.sessionId ?? basename(filePath, '.jsonl'),
        ts: entry.timestamp ?? new Date().toISOString(),
        cwd: entry.cwd ?? '',
        gitBranch: entry.gitBranch,
        toolName: block.name,
        commandText: commandText.slice(0, 4000),
        description,
        toolUseId: block.id,
        userPrompt: lastUserPrompt,
        reasoning: textBeforeTools || undefined,
        outcome: result?.outcome as ParsedCommand['outcome'] ?? 'unknown',
        resultText: result?.resultText,
        exitCode: result?.exitCode,
      });
    }
  }

  return commands;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: PG_URL });

  // Get already-ingested session files
  const ingested = await pool.query<{ source_path: string }>(
    `SELECT source_path FROM ingestion_sources WHERE source_path LIKE '%.jsonl'`
  );
  const ingestedPaths = new Set(ingested.rows.map(r => r.source_path));

  // Single-file mode (--file=<path>) — used by the Stop hook
  let newFiles: string[];
  if (singleFile) {
    newFiles = ingestedPaths.has(singleFile) ? [] : [singleFile];
    console.log(`📄 Single file mode: ${singleFile}${newFiles.length === 0 ? ' (already ingested)' : ''}`);
  } else {
    // Find all .jsonl files under projects dir
    const jsonlFiles: string[] = [];
    const projectDirs = await readdir(projectsDir).catch(() => [] as string[]);

    for (const proj of projectDirs) {
      const projPath = join(projectsDir, proj);
      const projStat = await stat(projPath).catch(() => null);
      if (!projStat?.isDirectory()) continue;

      const files = await readdir(projPath).catch(() => [] as string[]);
      for (const f of files) {
        if (f.endsWith('.jsonl')) jsonlFiles.push(join(projPath, f));
      }
    }

    // Also check top-level .jsonl files
    const rootFiles = await readdir(projectsDir).catch(() => [] as string[]);
    for (const f of rootFiles) {
      if (f.endsWith('.jsonl')) jsonlFiles.push(join(projectsDir, f));
    }

    newFiles = jsonlFiles.filter(f => !ingestedPaths.has(f));
    console.log(`📂 Found ${jsonlFiles.length} session files | ${newFiles.length} new`);
  }

  if (newFiles.length === 0) {
    console.log('✅ Nothing new to ingest.');
    await pool.end();
    return;
  }

  if (dryRun) {
    console.log('\n🔍 Dry run — new files:');
    for (const f of newFiles.slice(0, 10)) console.log(`  ${f}`);
    await pool.end();
    return;
  }

  let totalCommands = 0;
  let totalFiles = 0;

  for (const filePath of newFiles) {
    const raw = await readFile(filePath, 'utf-8').catch(() => null);
    if (!raw) continue;

    const lines = raw.split('\n');
    const commands = parseSession(lines, filePath);

    if (commands.length === 0) {
      // Mark as ingested even if empty (no tool calls)
      await pool.query(
        `INSERT INTO ingestion_sources (source_path, last_hash, chunk_count)
         VALUES ($1, 'empty', 0)
         ON CONFLICT (source_path) DO NOTHING`,
        [filePath]
      );
      continue;
    }

    process.stdout.write(`  ${basename(filePath)} — ${commands.length} commands...`);

    // Insert all commands for this session
    for (const cmd of commands) {
      const embedText = [cmd.commandText, cmd.description, cmd.reasoning].filter(Boolean).join(' ');
      const embedding = await generateEmbedding(embedText);
      const embeddingVal = embedding ? `[${embedding.join(',')}]` : null;

      await pool.query(`
        INSERT INTO command_log
          (agent_id, session_id, machine_id, project_path, git_branch, ts,
           tool_name, command_text, description, user_prompt, reasoning,
           outcome, result_text, exit_code, embedding)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector)
        ON CONFLICT DO NOTHING
      `, [
        agentId, cmd.sessionId, machineId, cmd.cwd, cmd.gitBranch ?? null,
        cmd.ts, cmd.toolName, cmd.commandText, cmd.description ?? null,
        cmd.userPrompt ?? null, cmd.reasoning ?? null,
        cmd.outcome ?? 'unknown', cmd.resultText ?? null, cmd.exitCode ?? null,
        embeddingVal,
      ]);
    }

    // Mark file as ingested
    await pool.query(
      `INSERT INTO ingestion_sources (source_path, last_hash, chunk_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_path) DO UPDATE SET
         last_hash = $2, chunk_count = $3, last_ingested = NOW()`,
      [filePath, lines.length.toString(), commands.length]
    );

    totalCommands += commands.length;
    totalFiles++;
    console.log(' ✓');
  }

  console.log(`\n✅ Ingested ${totalCommands} commands from ${totalFiles} sessions`);

  // Quick summary
  const summary = await pool.query(`
    SELECT tool_name, COUNT(*) as count,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors
    FROM command_log
    GROUP BY tool_name ORDER BY count DESC LIMIT 10
  `);
  console.log('\n📊 Top tools in command_log:');
  for (const row of summary.rows) {
    console.log(`   ${row.tool_name.padEnd(20)} ${row.count} calls (${row.errors} errors)`);
  }

  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
