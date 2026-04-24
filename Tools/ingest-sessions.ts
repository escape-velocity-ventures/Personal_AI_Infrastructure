#!/usr/bin/env bun
/**
 * Session JSONL Ingester
 *
 * Parses Claude Code .jsonl session files and populates command_log via Engram API.
 * Captures tool calls, their results, surrounding reasoning, and user prompt context.
 *
 * Usage:
 *   bun run ingest-sessions.ts [--dir ~/.claude/projects] [--machine plato] [--agent main] [--dry-run]
 *
 * Designed to run on any machine and ship logs to the Engram API.
 * Safe to re-run — skips already-ingested sessions via local tracking file.
 */

import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

// ─── Config ─────────────────────────────────────────────────────────────────

const ENGRAM_URL = process.env.ENGRAM_API_URL || process.env.MEMORY_API_URL || 'https://engram.escape-velocity-ventures.org';
const ENGRAM_KEY = process.env.ENGRAM_API_KEY || process.env.MEMORY_API_KEY || '';
const DEFAULT_PROJECTS_DIR = `${process.env.HOME}/.claude/projects`;
const TRACKING_DIR = join(process.env.HOME || '', '.claude', 'history');
const TRACKING_FILE = join(TRACKING_DIR, 'ingested-sessions.json');

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const dryRun = args.includes('--dry-run');
const singleFile = args.find(a => a.startsWith('--file='))?.split('=')[1];
const projectsDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] ?? DEFAULT_PROJECTS_DIR;
const machineId = args.find(a => a.startsWith('--machine='))?.split('=')[1] ?? process.env.HOSTNAME ?? 'unknown';
const agentId = args.find(a => a.startsWith('--agent='))?.split('=')[1] ?? process.env.ENGRAM_AGENT_ID ?? process.env.PAI_AGENT_ID ?? 'main';

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

// ─── Engram API ──────────────────────────────────────────────────────────────

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ENGRAM_KEY) headers['Authorization'] = `Bearer ${ENGRAM_KEY}`;
  return headers;
}

async function postTurn(turn: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(`${ENGRAM_URL}/turns`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(turn),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function postCommand(cmd: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(`${ENGRAM_URL}/commands`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Ingestion Tracking ──────────────────────────────────────────────────────

function loadIngestedPaths(): Set<string> {
  try {
    if (existsSync(TRACKING_FILE)) {
      const data = JSON.parse(readFileSync(TRACKING_FILE, 'utf-8'));
      return new Set(data.ingested || []);
    }
  } catch { /* start fresh */ }
  return new Set();
}

async function saveIngestedPaths(paths: Set<string>): Promise<void> {
  if (!existsSync(TRACKING_DIR)) mkdirSync(TRACKING_DIR, { recursive: true });
  await writeFile(TRACKING_FILE, JSON.stringify({ ingested: [...paths] }, null, 2));
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

interface ParsedTurn {
  sessionId: string;
  turnNumber: number;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  projectPath?: string;
}

function parseConversationTurns(lines: string[], filePath: string): ParsedTurn[] {
  const entries: JEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip */ }
  }

  const turns: ParsedTurn[] = [];
  let turnNumber = 0;

  for (const entry of entries) {
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;

    const content = entry.message?.content;
    if (!content) continue;

    let text: string;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      // Extract only text blocks — skip tool_use/tool_result
      text = content
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n')
        .trim();
    } else {
      continue;
    }

    if (!text) continue;

    // Strip system-reminder tags
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!text || text.length < 5) continue;

    // Truncate very long turns (>8K chars) to keep DB reasonable
    if (text.length > 8000) text = text.slice(0, 8000) + '\n[truncated]';

    turns.push({
      sessionId: entry.sessionId ?? basename(filePath, '.jsonl'),
      turnNumber: turnNumber++,
      role: entry.type === 'user' ? 'user' : 'assistant',
      content: text,
      ts: entry.timestamp ?? new Date().toISOString(),
      projectPath: entry.cwd,
    });
  }

  return turns;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ingestedPaths = loadIngestedPaths();

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
    return;
  }

  if (dryRun) {
    console.log('\n🔍 Dry run — new files:');
    for (const f of newFiles.slice(0, 10)) console.log(`  ${f}`);
    return;
  }

  let totalCommands = 0;
  let totalTurns = 0;
  let totalFiles = 0;
  let errors = 0;

  for (const filePath of newFiles) {
    const raw = await readFile(filePath, 'utf-8').catch(() => null);
    if (!raw) continue;

    const lines = raw.split('\n');
    const commands = parseSession(lines, filePath);
    const turns = parseConversationTurns(lines, filePath);

    if (commands.length === 0 && turns.length === 0) {
      ingestedPaths.add(filePath);
      continue;
    }

    process.stdout.write(`  ${basename(filePath)} — ${commands.length} cmds, ${turns.length} turns...`);

    // Post commands to Engram API
    for (const cmd of commands) {
      const ok = await postCommand({
        agentId: agentId,
        sessionId: cmd.sessionId,
        machineId: machineId,
        projectPath: cmd.cwd,
        gitBranch: cmd.gitBranch ?? null,
        ts: cmd.ts,
        toolName: cmd.toolName,
        commandText: cmd.commandText,
        description: cmd.description ?? null,
        userPrompt: cmd.userPrompt ?? null,
        reasoning: cmd.reasoning ?? null,
        outcome: cmd.outcome ?? 'unknown',
        resultText: cmd.resultText ?? null,
        exitCode: cmd.exitCode ?? null,
      });
      if (!ok) errors++;
    }

    // Post conversation turns in parallel batches (fan out to multiple Ollama pods)
    const CONCURRENCY = 3;
    for (let i = 0; i < turns.length; i += CONCURRENCY) {
      const batch = turns.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(t => postTurn({
        sessionId: t.sessionId,
        turnNumber: t.turnNumber,
        role: t.role,
        content: t.content,
        agentId: agentId,
        machineId: machineId,
        projectPath: t.projectPath ?? null,
        ts: t.ts,
      })));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) totalTurns++;
        else errors++;
      }
    }

    ingestedPaths.add(filePath);
    totalCommands += commands.length;
    totalFiles++;
    console.log(' ✓');
  }

  // Persist tracking
  await saveIngestedPaths(ingestedPaths);

  console.log(`\n✅ Ingested ${totalCommands} commands + ${totalTurns} turns from ${totalFiles} sessions` +
    (errors > 0 ? ` (${errors} errors)` : ''));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
