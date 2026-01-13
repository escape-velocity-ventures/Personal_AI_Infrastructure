#!/usr/bin/env bun
/**
 * ConversationSync.ts - Auto-sync AI conversation counts to TELOS metrics
 *
 * Counts Claude Code sessions from ~/.claude/projects/ by date and logs
 * them to the ai_conversations KPI.
 *
 * Commands:
 *   sync [--days 7]    Sync conversation counts for the last N days
 *   today              Show today's conversation count
 *   history            Show conversation history by day
 */

import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logMetric, getMetricsForDate } from "./MetricsLogger";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const KPI_ID = "ai_conversations";

interface ConversationCount {
  date: string;
  count: number;
  projects: Map<string, number>;
}

/**
 * Get all .jsonl files from Claude projects directory
 */
function getConversationFiles(): Array<{ path: string; mtime: Date; project: string }> {
  const files: Array<{ path: string; mtime: Date; project: string }> = [];

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    console.warn(`Claude projects directory not found: ${CLAUDE_PROJECTS_DIR}`);
    return files;
  }

  const projects = readdirSync(CLAUDE_PROJECTS_DIR);

  for (const project of projects) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, project);
    const stat = statSync(projectPath);

    if (!stat.isDirectory()) continue;

    // Find .jsonl files in project directory
    const projectFiles = readdirSync(projectPath);

    for (const file of projectFiles) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(projectPath, file);
      const fileStat = statSync(filePath);

      // Skip empty files (aborted sessions)
      if (fileStat.size === 0) continue;

      files.push({
        path: filePath,
        mtime: fileStat.mtime,
        project: project
      });
    }
  }

  return files;
}

/**
 * Count conversations by date
 */
function countByDate(days: number = 30): ConversationCount[] {
  const files = getConversationFiles();
  const counts = new Map<string, ConversationCount>();

  // Initialize dates
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    counts.set(dateStr, { date: dateStr, count: 0, projects: new Map() });
  }

  // Count files by modification date
  for (const file of files) {
    const dateStr = file.mtime.toISOString().split("T")[0];
    const existing = counts.get(dateStr);

    if (existing) {
      existing.count++;
      const projectCount = existing.projects.get(file.project) || 0;
      existing.projects.set(file.project, projectCount + 1);
    }
  }

  // Sort by date descending
  return Array.from(counts.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get count for a specific date
 */
function getCountForDate(date: Date): number {
  const dateStr = date.toISOString().split("T")[0];
  const files = getConversationFiles();

  return files.filter(f => f.mtime.toISOString().split("T")[0] === dateStr).length;
}

/**
 * Check if we already logged for a date
 */
function hasLoggedForDate(date: Date): boolean {
  const entries = getMetricsForDate(date);
  return entries.some(e => e.kpi_id === KPI_ID);
}

/**
 * Sync conversation counts to TELOS metrics
 */
async function syncConversations(days: number = 7): Promise<void> {
  console.log(`\n🔄 Syncing AI conversation counts for last ${days} days...\n`);

  const counts = countByDate(days);
  let synced = 0;
  let skipped = 0;

  for (const { date, count } of counts) {
    const dateObj = new Date(date + "T12:00:00");

    // Skip if already logged (unless it's today - we can update today's count)
    const isToday = date === new Date().toISOString().split("T")[0];

    if (hasLoggedForDate(dateObj) && !isToday) {
      skipped++;
      continue;
    }

    if (count > 0) {
      // For historical dates, log with the actual date's timestamp
      // For today, use current timestamp
      try {
        const logTimestamp = isToday ? undefined : dateObj;
        logMetric(KPI_ID, count, isToday ? undefined : "auto-sync", logTimestamp);
        console.log(`  ${date}: ${count} conversations ${isToday ? "(today)" : "(historical)"}`);
        synced++;
      } catch (error) {
        console.error(`  ${date}: Error logging - ${error}`);
      }
    }
  }

  console.log(`\n✅ Synced ${synced} days, skipped ${skipped} (already logged)`);
}

/**
 * Show today's count
 */
function showToday(): void {
  const today = new Date();
  const count = getCountForDate(today);
  const logged = hasLoggedForDate(today);

  console.log(`\n📊 Today's AI Conversations: ${count}`);
  console.log(`   Already logged: ${logged ? "Yes" : "No"}`);

  // Show breakdown by project
  const files = getConversationFiles();
  const todayStr = today.toISOString().split("T")[0];
  const todayFiles = files.filter(f => f.mtime.toISOString().split("T")[0] === todayStr);

  if (todayFiles.length > 0) {
    const byProject = new Map<string, number>();
    for (const f of todayFiles) {
      const count = byProject.get(f.project) || 0;
      byProject.set(f.project, count + 1);
    }

    console.log("\n   By project:");
    for (const [project, count] of Array.from(byProject.entries()).sort((a, b) => b[1] - a[1])) {
      const shortName = project.replace(/-Users-benjamin-/g, "").slice(0, 40);
      console.log(`     ${shortName}: ${count}`);
    }
  }
}

/**
 * Show conversation history
 */
function showHistory(days: number = 14): void {
  const counts = countByDate(days);

  console.log(`\n📈 AI Conversation History (Last ${days} days)\n`);
  console.log("   Date        | Count | Bar");
  console.log("   ------------|-------|" + "-".repeat(52));

  const maxCount = Math.max(...counts.map(c => c.count), 1);

  for (const { date, count } of counts) {
    const bar = "█".repeat(Math.round((count / maxCount) * 50));
    const dayName = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    console.log(`   ${date} ${dayName} | ${count.toString().padStart(5)} | ${bar}`);
  }

  // Stats
  const totalCount = counts.reduce((acc, c) => acc + c.count, 0);
  const avgCount = totalCount / counts.length;
  const activeDays = counts.filter(c => c.count > 0).length;

  console.log(`\n   Total: ${totalCount} conversations`);
  console.log(`   Average: ${avgCount.toFixed(1)}/day`);
  console.log(`   Active days: ${activeDays}/${days}`);
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "sync";

  switch (command) {
    case "sync": {
      const daysIndex = args.indexOf("--days");
      const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 7;
      await syncConversations(days);
      break;
    }

    case "today":
      showToday();
      break;

    case "history": {
      const daysIndex = args.indexOf("--days");
      const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 14;
      showHistory(days);
      break;
    }

    case "help":
    default:
      console.log("AI Conversation Sync for TELOS\n");
      console.log("Commands:");
      console.log("  sync [--days 7]    Sync conversation counts to TELOS metrics");
      console.log("  today              Show today's conversation count");
      console.log("  history [--days 14] Show conversation history");
      console.log("  help               Show this help");
  }
}

if (import.meta.main) {
  main();
}
