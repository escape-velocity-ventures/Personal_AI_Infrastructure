#!/usr/bin/env bun
/**
 * DailyBriefing.ts - Generate daily alignment report
 *
 * Combines TELOS goals with KPI progress to show:
 * - Active goals and their status
 * - Yesterday's metrics summary
 * - Streak tracking
 * - Focus suggestions
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { homedir } from "os";
import { dirname } from "path";

// Import parser and logger
import { parseTelos, type TelosData, type TelosItem } from "./TelosParser";
import {
  getProgress,
  getMetricsForDate,
  calculateStreak,
  calculateAverage
} from "./MetricsLogger";

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
const PAI_DIR = process.env.PAI_DIR || `${homedir()}/.claude`;
const PACK_DIR = dirname(dirname(dirname(import.meta.path)));
const CONFIG_PATH = `${PACK_DIR}/data/kpi-config.yaml`;
const TELOS_PATH = `${PAI_DIR}/skills/CORE/USER/TELOS.md`;

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
 * Get KPIs for a specific goal
 */
function getKpisForGoal(config: KpiConfigFile, goalRef: string): KpiConfig[] {
  return config.kpis.filter(k => k.goal_ref === goalRef);
}

/**
 * Generate focus suggestions based on underperforming KPIs
 */
function generateFocusSuggestions(
  progress: ReturnType<typeof getProgress>,
  config: KpiConfigFile
): string[] {
  const suggestions: string[] = [];

  // Find KPIs below target
  const belowTarget = progress.filter(p => !p.onTrack && p.kpi.frequency === "daily");

  for (const p of belowTarget.slice(0, 3)) {
    const trendText = p.trend !== null
      ? ` (${p.trend.toFixed(1)} avg over ${config.display.trend_period_days} days)`
      : "";

    if (p.kpi.type === "duration") {
      suggestions.push(
        `**${p.kpi.name}** is at ${p.current}/${p.target} ${p.kpi.unit || ""}${trendText}. Consider blocking focused time.`
      );
    } else if (p.kpi.type === "counter") {
      suggestions.push(
        `**${p.kpi.name}** is at ${p.current}/${p.target}${trendText}. Small progress adds up.`
      );
    } else if (p.kpi.type === "boolean" && !p.current) {
      suggestions.push(
        `**${p.kpi.name}** not yet completed today. Quick win available.`
      );
    }
  }

  // Celebrate streaks
  const goodStreaks = progress.filter(p => p.streak >= 7);
  for (const p of goodStreaks.slice(0, 2)) {
    const milestone = config.streaks.milestones.filter(m => m <= p.streak).pop();
    if (milestone) {
      const message = config.streaks.celebration_messages[milestone];
      if (message) {
        suggestions.push(`**${p.kpi.name}**: ${p.streak} day streak! ${message}`);
      }
    }
  }

  return suggestions;
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Generate the daily briefing
 */
export function generateBriefing(): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let briefing = `## Daily Alignment Briefing - ${formatDate(today)}\n\n`;

  // Load TELOS data
  let telos: TelosData | null = null;
  try {
    telos = parseTelos(TELOS_PATH);
  } catch (e) {
    briefing += `> TELOS.md not found at ${TELOS_PATH}\n\n`;
  }

  // Load KPI config
  let config: KpiConfigFile;
  try {
    config = loadConfig();
  } catch (e) {
    briefing += `> KPI config not found. Run setup first.\n\n`;
    return briefing;
  }

  // Active Goals section
  if (telos && telos.goals.length > 0) {
    briefing += "### Active Goals\n\n";

    for (const goal of telos.goals) {
      const kpis = getKpisForGoal(config, goal.id);
      const kpiNames = kpis.length > 0
        ? ` (${kpis.map(k => k.name).join(", ")})`
        : "";
      const category = goal.category ? ` [${goal.category}]` : "";

      briefing += `- **${goal.id}${category}:** ${goal.content}${kpiNames}\n`;
    }
    briefing += "\n";
  }

  // KPI Progress section
  briefing += "### KPI Progress\n\n";

  const progress = getProgress();

  if (progress.length === 0) {
    briefing += "> No KPIs configured yet.\n\n";
  } else {
    briefing += "| KPI | Today | Target | 7-Day Avg | Streak | Status |\n";
    briefing += "|-----|-------|--------|-----------|--------|--------|\n";

    for (const p of progress) {
      const status = p.onTrack ? "On Track" : "Below";
      const trend = p.trend !== null ? p.trend.toFixed(1) : "-";
      const streak = p.streak > 0 ? `${p.streak}d` : "-";
      const unit = p.kpi.unit || "";

      briefing += `| ${p.kpi.name} | ${p.current} ${unit} | ${p.target} ${unit} | ${trend} | ${streak} | ${status} |\n`;
    }
    briefing += "\n";
  }

  // Yesterday's activity
  const yesterdayMetrics = getMetricsForDate(yesterday);
  if (yesterdayMetrics.length > 0) {
    briefing += "### Yesterday's Activity\n\n";
    for (const m of yesterdayMetrics) {
      const kpi = config.kpis.find(k => k.id === m.kpi_id);
      const name = kpi?.name || m.kpi_id;
      const note = m.note ? ` - ${m.note}` : "";
      briefing += `- ${name}: ${m.value} ${kpi?.unit || ""}${note}\n`;
    }
    briefing += "\n";
  }

  // Streaks section
  const activeStreaks = progress.filter(p => p.streak >= 3);
  if (activeStreaks.length > 0) {
    briefing += "### Active Streaks\n\n";
    for (const p of activeStreaks) {
      const milestone = config.streaks.milestones.filter(m => m <= p.streak).pop();
      const emoji = milestone && milestone >= 7 ? "+" : " ";
      briefing += `${emoji} **${p.kpi.name}:** ${p.streak} days\n`;
    }
    briefing += "\n";
  }

  // Focus suggestions
  const suggestions = generateFocusSuggestions(progress, config);
  if (suggestions.length > 0) {
    briefing += "### Focus Suggestions\n\n";
    for (const s of suggestions) {
      briefing += `- ${s}\n`;
    }
    briefing += "\n";
  }

  // Current projects from TELOS
  if (telos && telos.projects.length > 0) {
    const activeProjects = telos.projects.filter(p => p.status === "Active");
    if (activeProjects.length > 0) {
      briefing += "### Active Projects\n\n";
      for (const p of activeProjects) {
        briefing += `- **${p.name}:** ${p.description}\n`;
      }
      briefing += "\n";
    }
  }

  // Recent journal entries
  if (telos && telos.journal.length > 0) {
    const recent = telos.journal.slice(-3);
    briefing += "### Recent Journal\n\n";
    for (const j of recent) {
      briefing += `- **${j.date}:** ${j.content}\n`;
    }
    briefing += "\n";
  }

  return briefing;
}

/**
 * Generate compact briefing for hook output
 */
export function generateCompactBriefing(): string {
  const today = new Date();
  let output = `TELOS Briefing ${formatDate(today)}\n`;

  try {
    const progress = getProgress();
    const onTrack = progress.filter(p => p.onTrack).length;
    const total = progress.length;

    output += `KPIs: ${onTrack}/${total} on track\n`;

    // Top streaks
    const streaks = progress
      .filter(p => p.streak >= 3)
      .sort((a, b) => b.streak - a.streak)
      .slice(0, 3);

    if (streaks.length > 0) {
      output += `Streaks: ${streaks.map(s => `${s.kpi.name}(${s.streak}d)`).join(", ")}\n`;
    }

    // Needs attention
    const needsAttention = progress
      .filter(p => !p.onTrack && p.kpi.frequency === "daily")
      .slice(0, 2);

    if (needsAttention.length > 0) {
      output += `Focus: ${needsAttention.map(p => p.kpi.name).join(", ")}\n`;
    }
  } catch (e) {
    output += "No metrics data yet.\n";
  }

  return output;
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const compact = args.includes("--compact");
  const json = args.includes("--json");

  try {
    if (compact) {
      console.log(generateCompactBriefing());
    } else if (json) {
      const telos = existsSync(TELOS_PATH) ? parseTelos(TELOS_PATH) : null;
      const progress = getProgress();
      const config = loadConfig();

      console.log(JSON.stringify({
        date: formatDate(new Date()),
        telos: telos ? {
          goals: telos.goals,
          projects: telos.projects.filter(p => p.status === "Active"),
          journal: telos.journal.slice(-5)
        } : null,
        kpis: progress.map(p => ({
          id: p.kpi.id,
          name: p.kpi.name,
          current: p.current,
          target: p.target,
          percentage: p.percentage,
          onTrack: p.onTrack,
          streak: p.streak,
          trend: p.trend,
          goalRef: p.kpi.goal_ref
        })),
        suggestions: generateFocusSuggestions(progress, config)
      }, null, 2));
    } else {
      console.log(generateBriefing());
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
