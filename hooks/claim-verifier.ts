#!/usr/bin/env bun
/**
 * claim-verifier — Stop hook that detects unsubstantiated superlative market claims.
 *
 * Scans the last assistant response for patterns like:
 *   "no other tool...", "unique in the market", "first to...", etc.
 *
 * When a pattern fires, it prints a warning to stderr so it's visible to the user
 * and logs to ~/.claude/claim-verifier.log for later audit.
 *
 * Does NOT block the response — this is advisory only. The user decides whether
 * to follow up with verification.
 *
 * Hook event: Stop
 */

import { readFileSync, existsSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface HookInput {
  transcript_path?: string;
  transcriptPath?: string;
  hook_event_name?: string;
}

interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

const SUPERLATIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /no other (tool|platform|product|company|software|solution|system)\b/gi,
    label: "no-other-X",
  },
  {
    pattern: /\b(unique|only one) (in the market|on the market|available)\b/gi,
    label: "unique-in-market",
  },
  {
    pattern: /\bfirst (tool|platform|product|company|to)\b/gi,
    label: "first-X",
  },
  {
    pattern: /\bcompetitors? (don'?t|do not|can'?t|cannot|won'?t|will not)\b/gi,
    label: "competitors-cant",
  },
  {
    pattern: /\bonly (tool|platform|product|solution|system) that\b/gi,
    label: "only-X-that",
  },
  {
    pattern: /\bnobody (else )?(has|offers|does|provides|supports)\b/gi,
    label: "nobody-else",
  },
  {
    pattern: /\bunmatched\b|\bunrivaled\b|\bunsurpassed\b|\bpeerless\b/gi,
    label: "superlative-adjective",
  },
];

function extractLastAssistantText(transcriptPath: string): string | null {
  if (!existsSync(transcriptPath)) return null;

  const lines = readFileSync(transcriptPath, "utf-8")
    .split("\n")
    .filter(Boolean);

  let lastText: string | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;

      // Claude Code format
      if (entry.type === "assistant" && entry.message?.content) {
        const content = entry.message.content;
        if (typeof content === "string") {
          lastText = content;
        } else if (Array.isArray(content)) {
          lastText = content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)
            .join("\n");
        }
      }

      // Factory/Droid format
      if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        entry.message?.content
      ) {
        const content = entry.message.content;
        if (typeof content === "string") {
          lastText = content;
        } else if (Array.isArray(content)) {
          lastText = content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)
            .join("\n");
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  return lastText;
}

function findMatches(text: string): Array<{ label: string; match: string }> {
  const results: Array<{ label: string; match: string }> = [];
  for (const { pattern, label } of SUPERLATIVE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        results.push({ label, match });
      }
    }
  }
  return results;
}

function logToFile(entries: Array<{ label: string; match: string }>): void {
  const logPath = join(homedir(), ".claude", "claim-verifier.log");
  const timestamp = new Date().toISOString();
  for (const e of entries) {
    appendFileSync(logPath, `${timestamp}\t${e.label}\t${e.match}\n`);
  }
}

async function main() {
  let hookInput: HookInput = {};
  try {
    const raw = readFileSync("/dev/stdin", "utf-8").trim();
    if (raw) hookInput = JSON.parse(raw);
  } catch {
    // no stdin
  }

  const transcriptPath =
    hookInput.transcript_path ?? hookInput.transcriptPath;
  if (!transcriptPath) process.exit(0);

  const text = extractLastAssistantText(transcriptPath);
  if (!text) process.exit(0);

  const matches = findMatches(text);
  if (matches.length === 0) process.exit(0);

  // Warn — visible in the terminal, doesn't block
  console.error(
    `\n⚠️  [claim-verifier] ${matches.length} unverified market claim(s) detected:`
  );
  for (const m of matches) {
    console.error(`   [${m.label}] "${m.match}"`);
  }
  console.error(
    `   → Substantiate with data or soften before publishing.\n`
  );

  logToFile(matches);

  // Exit 0 — advisory only, never blocks
  process.exit(0);
}

main();
