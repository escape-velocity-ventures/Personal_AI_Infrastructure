#!/usr/bin/env bun
/**
 * MetricsLogger.ts - Log and query KPI measurements
 *
 * Commands:
 *   log --kpi <id> --value <n> [--note "..."]  Log a KPI value
 *   today                                       Show today's entries
 *   summary [--days 7]                         Show summary with trends
 *   status                                     Show current progress vs targets
 *   streak <kpi_id>                            Show streak for a KPI
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { parse as parseYaml } from "yaml";
import { dirname } from "path";
import { hostname, platform } from "os";
import { execSync } from "child_process";

/**
 * Get machine identifier - prefers macOS LocalHostName for uniqueness
 */
function getMachineId(): string {
  if (platform() === "darwin") {
    try {
      return execSync("scutil --get LocalHostName", { encoding: "utf-8" }).trim();
    } catch {
      // Fall back to hostname if scutil fails
    }
  }
  return hostname();
}

// Types
interface KpiConfig {
  id: string;
  name: string;
  description: string;
  goal_ref: string | null;
  type: "counter" | "duration" | "boolean" | "rating";
  target: number | boolean;
  frequency: "daily" | "weekly";
  unit?: string;
}

interface MetricEntry {
  timestamp: string;
  kpi_id: string;
  value: number | boolean;
  goal_ref: string | null;
  machine?: string;
  note?: string;
  source?: string;
}

interface KpiConfigFile {
  kpis: KpiConfig[];
  streaks: {
    enabled: boolean;
    milestones: number[];
    celebration_messages: Record<number, string>;
  };
  display: {
    show_trends: boolean;
    trend_period_days: number;
    highlight_below_target: boolean;
    group_by_goal: boolean;
  };
}

// Paths
const PACK_DIR = dirname(dirname(dirname(import.meta.path)));
const CONFIG_PATH = `${PACK_DIR}/data/kpi-config.yaml`;
const METRICS_PATH = `${PACK_DIR}/data/metrics.jsonl`;

/**
 * Load KPI configuration
 */
function loadConfig(): KpiConfigFile {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`KPI config not found: ${CONFIG_PATH}`);
  }
  const content = readFileSync(CONFIG_PATH, "utf-8");
  return parseYaml(content) as KpiConfigFile;
}

/**
 * Get KPI by ID
 */
function getKpi(config: KpiConfigFile, kpiId: string): KpiConfig | undefined {
  return config.kpis.find(k => k.id === kpiId);
}

/**
 * Load all metric entries
 */
function loadMetrics(): MetricEntry[] {
  if (!existsSync(METRICS_PATH)) {
    return [];
  }

  const content = readFileSync(METRICS_PATH, "utf-8");
  return content
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as MetricEntry);
}

/**
 * Log a metric entry
 */
export function logMetric(
  kpiId: string,
  value: number | boolean,
  note?: string,
  timestamp?: Date
): MetricEntry {
  const config = loadConfig();
  const kpi = getKpi(config, kpiId);

  if (!kpi) {
    throw new Error(`Unknown KPI: ${kpiId}. Available: ${config.kpis.map(k => k.id).join(", ")}`);
  }

  const entry: MetricEntry = {
    timestamp: (timestamp || new Date()).toISOString(),
    kpi_id: kpiId,
    value,
    goal_ref: kpi.goal_ref,
    machine: getMachineId()
  };

  if (note) {
    entry.note = note;
  }

  // Ensure data directory exists
  const dataDir = dirname(METRICS_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Append to JSONL file
  appendFileSync(METRICS_PATH, JSON.stringify(entry) + "\n");

  return entry;
}

/**
 * Get metrics for a specific date
 */
export function getMetricsForDate(date: Date): MetricEntry[] {
  const metrics = loadMetrics();
  const dateStr = date.toISOString().split("T")[0];

  return metrics.filter(m => m.timestamp.startsWith(dateStr));
}

/**
 * Get unique machines that have contributed metrics
 */
export function getUniqueMachines(): string[] {
  const metrics = loadMetrics();
  const machines = new Set<string>();

  for (const m of metrics) {
    if (m.machine) {
      machines.add(m.machine);
    }
  }

  return Array.from(machines);
}

/**
 * Get metrics for the last N days
 */
export function getMetricsForDays(days: number): MetricEntry[] {
  const metrics = loadMetrics();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return metrics.filter(m => new Date(m.timestamp) >= cutoff);
}

/**
 * Calculate average for a KPI over a period
 */
export function calculateAverage(kpiId: string, days: number): number | null {
  const metrics = getMetricsForDays(days).filter(m => m.kpi_id === kpiId);

  if (metrics.length === 0) return null;

  const sum = metrics.reduce((acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)), 0);
  return sum / metrics.length;
}

/**
 * Calculate streak for a KPI
 */
export function calculateStreak(kpiId: string): number {
  const config = loadConfig();
  const kpi = getKpi(config, kpiId);
  if (!kpi) return 0;

  const metrics = loadMetrics()
    .filter(m => m.kpi_id === kpiId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (metrics.length === 0) return 0;

  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  // Check each day going backwards
  for (let i = 0; i < 365; i++) {
    const dayStr = currentDate.toISOString().split("T")[0];
    const dayMetrics = metrics.filter(m => m.timestamp.startsWith(dayStr));

    // For daily KPIs, check if target was met
    if (kpi.frequency === "daily") {
      if (dayMetrics.length === 0) {
        // No entry for this day - streak broken (unless it's today)
        if (i > 0) break;
      } else {
        const value = dayMetrics.reduce(
          (acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)),
          0
        );
        const target = typeof kpi.target === "number" ? kpi.target : (kpi.target ? 1 : 0);
        if (value >= target) {
          streak++;
        } else if (i > 0) {
          break;
        }
      }
    }

    currentDate.setDate(currentDate.getDate() - 1);
  }

  return streak;
}

/**
 * Get current progress vs targets
 */
export function getProgress(): Array<{
  kpi: KpiConfig;
  current: number;
  target: number | boolean;
  percentage: number;
  onTrack: boolean;
  streak: number;
  trend: number | null;
}> {
  const config = loadConfig();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  return config.kpis.map(kpi => {
    // Get today's metrics for this KPI
    const todayMetrics = loadMetrics().filter(
      m => m.kpi_id === kpi.id && m.timestamp.startsWith(todayStr)
    );

    const current = todayMetrics.reduce(
      (acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)),
      0
    );

    const targetNum = typeof kpi.target === "number" ? kpi.target : (kpi.target ? 1 : 0);
    const percentage = targetNum > 0 ? Math.round((current / targetNum) * 100) : 0;

    return {
      kpi,
      current,
      target: kpi.target,
      percentage: Math.min(percentage, 100),
      onTrack: current >= targetNum,
      streak: calculateStreak(kpi.id),
      trend: calculateAverage(kpi.id, config.display.trend_period_days)
    };
  });
}

/**
 * Format progress as table
 */
function formatProgressTable(progress: ReturnType<typeof getProgress>): string {
  const config = loadConfig();
  let output = "";

  if (config.display.group_by_goal) {
    // Group by goal
    const byGoal = new Map<string, typeof progress>();

    for (const p of progress) {
      const key = p.kpi.goal_ref || "General";
      if (!byGoal.has(key)) byGoal.set(key, []);
      byGoal.get(key)!.push(p);
    }

    for (const [goal, items] of byGoal) {
      output += `\n### ${goal}\n\n`;
      output += "| KPI | Current | Target | Progress | Streak |\n";
      output += "|-----|---------|--------|----------|--------|\n";

      for (const p of items) {
        const status = p.onTrack ? "+" : "-";
        const progressBar = `${p.percentage}%`;
        const streak = p.streak > 0 ? `${p.streak}d` : "-";
        output += `| ${status} ${p.kpi.name} | ${p.current} | ${p.target} ${p.kpi.unit || ""} | ${progressBar} | ${streak} |\n`;
      }
    }
  } else {
    output += "| KPI | Current | Target | Progress | Streak |\n";
    output += "|-----|---------|--------|----------|--------|\n";

    for (const p of progress) {
      const status = p.onTrack ? "+" : "-";
      const progressBar = `${p.percentage}%`;
      const streak = p.streak > 0 ? `${p.streak}d` : "-";
      output += `| ${status} ${p.kpi.name} | ${p.current} | ${p.target} ${p.kpi.unit || ""} | ${progressBar} | ${streak} |\n`;
    }
  }

  return output;
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "log": {
        const kpiIndex = args.indexOf("--kpi");
        const valueIndex = args.indexOf("--value");
        const noteIndex = args.indexOf("--note");

        if (kpiIndex === -1 || valueIndex === -1) {
          console.error("Usage: log --kpi <id> --value <n> [--note \"...\"]");
          process.exit(1);
        }

        const kpiId = args[kpiIndex + 1];
        const value = args[valueIndex + 1] === "true" ? true :
                      args[valueIndex + 1] === "false" ? false :
                      parseFloat(args[valueIndex + 1]);
        const note = noteIndex !== -1 ? args[noteIndex + 1] : undefined;

        const entry = logMetric(kpiId, value, note);
        console.log("Logged:", JSON.stringify(entry, null, 2));
        break;
      }

      case "today": {
        const entries = getMetricsForDate(new Date());
        if (entries.length === 0) {
          console.log("No entries for today.");
        } else {
          console.log("Today's Entries:\n");
          for (const e of entries) {
            const time = new Date(e.timestamp).toLocaleTimeString();
            console.log(`  ${time} - ${e.kpi_id}: ${e.value}${e.note ? ` (${e.note})` : ""}`);
          }
        }
        break;
      }

      case "summary": {
        const daysIndex = args.indexOf("--days");
        const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 7;

        const config = loadConfig();
        console.log(`\nKPI Summary (Last ${days} days)\n`);

        for (const kpi of config.kpis) {
          const avg = calculateAverage(kpi.id, days);
          const streak = calculateStreak(kpi.id);
          const target = typeof kpi.target === "number" ? kpi.target : (kpi.target ? 1 : 0);

          if (avg !== null) {
            const status = avg >= target ? "+" : "-";
            console.log(`${status} ${kpi.name}: avg ${avg.toFixed(1)} (target: ${target}, streak: ${streak}d)`);
          } else {
            console.log(`  ${kpi.name}: no data`);
          }
        }
        break;
      }

      case "status": {
        const progress = getProgress();
        console.log("\nKPI Status\n");
        console.log(formatProgressTable(progress));
        break;
      }

      case "streak": {
        const kpiId = args[1];
        if (!kpiId) {
          console.error("Usage: streak <kpi_id>");
          process.exit(1);
        }

        const streak = calculateStreak(kpiId);
        const config = loadConfig();

        console.log(`\nStreak for ${kpiId}: ${streak} days`);

        if (config.streaks.enabled) {
          const milestone = config.streaks.milestones.filter(m => m <= streak).pop();
          if (milestone) {
            const message = config.streaks.celebration_messages[milestone];
            if (message) console.log(`\n${message}`);
          }
        }
        break;
      }

      case "list": {
        const config = loadConfig();
        console.log("\nAvailable KPIs:\n");
        for (const kpi of config.kpis) {
          console.log(`  ${kpi.id}`);
          console.log(`    ${kpi.name} - ${kpi.description}`);
          console.log(`    Target: ${kpi.target} ${kpi.unit || ""} (${kpi.frequency})`);
          console.log(`    Goal: ${kpi.goal_ref || "General"}\n`);
        }
        break;
      }

      default:
        console.log("TELOS Metrics Logger\n");
        console.log("Commands:");
        console.log("  log --kpi <id> --value <n> [--note \"...\"]  Log a KPI value");
        console.log("  today                                       Show today's entries");
        console.log("  summary [--days 7]                         Show summary with trends");
        console.log("  status                                     Show current progress");
        console.log("  streak <kpi_id>                            Show streak for a KPI");
        console.log("  list                                       List available KPIs");
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}
