#!/usr/bin/env bun
/**
 * telos-briefing.ts - SessionStart hook for TELOS Metrics
 *
 * Displays daily alignment briefing at session start.
 * Shows KPI progress, streaks, and focus suggestions.
 */

import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { shouldRun } from '/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src';

interface SessionStartPayload {
  session_id: string;
  [key: string]: any;
}

// Resolve paths relative to this hook's location
const HOOK_DIR = dirname(import.meta.path);
const PACK_DIR = dirname(HOOK_DIR);
const PAI_DIR = process.env.PAI_DIR || join(homedir(), ".claude");

const CONFIG_PATH = join(PACK_DIR, "data", "kpi-config.yaml");
const METRICS_PATH = join(PACK_DIR, "data", "metrics.jsonl");
const TELOS_PATH = join(PAI_DIR, "skills", "CORE", "USER", "TELOS.md");

// Removed isSubagentSession() - now using shouldRun() from pai-gastown-bridge

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

interface KpiConfig {
  id: string;
  name: string;
  goal_ref: string | null;
  target: number | boolean;
  frequency: string;
  unit?: string;
}

interface MetricEntry {
  timestamp: string;
  kpi_id: string;
  value: number | boolean;
}

interface KpiConfigFile {
  kpis: KpiConfig[];
}

function loadConfig(): KpiConfigFile | null {
  if (!existsSync(CONFIG_PATH)) return null;
  const content = readFileSync(CONFIG_PATH, "utf-8");
  return parseYaml(content) as KpiConfigFile;
}

function loadMetrics(): MetricEntry[] {
  if (!existsSync(METRICS_PATH)) return [];
  const content = readFileSync(METRICS_PATH, "utf-8");
  return content
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as MetricEntry);
}

function calculateStreak(kpiId: string, metrics: MetricEntry[], target: number): number {
  const kpiMetrics = metrics
    .filter(m => m.kpi_id === kpiId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (kpiMetrics.length === 0) return 0;

  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const dayStr = currentDate.toISOString().split("T")[0];
    const dayMetrics = kpiMetrics.filter(m => m.timestamp.startsWith(dayStr));

    if (dayMetrics.length === 0) {
      if (i > 0) break;
    } else {
      const value = dayMetrics.reduce(
        (acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)),
        0
      );
      if (value >= target) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }

    currentDate.setDate(currentDate.getDate() - 1);
  }

  return streak;
}

function generateCompactBriefing(): string {
  const config = loadConfig();
  if (!config) {
    return "TELOS Metrics: Not configured";
  }

  const metrics = loadMetrics();
  const today = formatDate(new Date());

  // Calculate progress for each KPI
  const progress = config.kpis.map(kpi => {
    const todayMetrics = metrics.filter(
      m => m.kpi_id === kpi.id && m.timestamp.startsWith(today)
    );
    const current = todayMetrics.reduce(
      (acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)),
      0
    );
    const targetNum = typeof kpi.target === "number" ? kpi.target : (kpi.target ? 1 : 0);
    const streak = calculateStreak(kpi.id, metrics, targetNum);

    return {
      kpi,
      current,
      target: targetNum,
      onTrack: current >= targetNum,
      streak
    };
  });

  const onTrack = progress.filter(p => p.onTrack).length;
  const total = progress.length;

  let output = `**TELOS Briefing** - ${today}\n\n`;
  output += `KPIs: ${onTrack}/${total} on track today\n`;

  // Active streaks
  const activeStreaks = progress
    .filter(p => p.streak >= 3)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 3);

  if (activeStreaks.length > 0) {
    output += `Streaks: ${activeStreaks.map(s => `${s.kpi.name} (${s.streak}d)`).join(", ")}\n`;
  }

  // Needs attention (daily KPIs not on track)
  const needsAttention = progress
    .filter(p => !p.onTrack && p.kpi.frequency === "daily")
    .slice(0, 3);

  if (needsAttention.length > 0) {
    output += `Focus: ${needsAttention.map(p => `${p.kpi.name} (${p.current}/${p.target})`).join(", ")}\n`;
  }

  // Check for TELOS goals
  if (existsSync(TELOS_PATH)) {
    const telosContent = readFileSync(TELOS_PATH, "utf-8");
    const goalMatches = telosContent.match(/\*\*G\d+:\*\*/g);
    if (goalMatches) {
      output += `Active Goals: ${goalMatches.length}\n`;
    }
  }

  return output;
}

async function main() {
  try {
    // Check if telos feature should run (handles GT roles, subagents, headless mode)
    const runResult = shouldRun({ feature: 'telos' });
    if (!runResult.shouldRun) {
      process.exit(0);
    }

    const stdinData = await Bun.stdin.text();
    if (!stdinData.trim()) {
      process.exit(0);
    }

    // Parse payload (though we don't need much from it)
    const _payload: SessionStartPayload = JSON.parse(stdinData);

    // Check if metrics pack is configured
    if (!existsSync(CONFIG_PATH)) {
      // Silently skip if not configured
      process.exit(0);
    }

    const briefing = generateCompactBriefing();

    // Output as system-reminder
    const output = `<system-reminder>
${briefing}

Use \`bun run ${PACK_DIR}/src/tools/DailyBriefing.ts\` for full briefing.
Use \`bun run ${PACK_DIR}/src/tools/MetricsLogger.ts log --kpi <id> --value <n>\` to log metrics.
</system-reminder>`;

    console.log(output);

  } catch (error) {
    // Never crash - just skip
    if (process.env.DEBUG) {
      console.error("TELOS briefing error:", error);
    }
  }

  process.exit(0);
}

main();
