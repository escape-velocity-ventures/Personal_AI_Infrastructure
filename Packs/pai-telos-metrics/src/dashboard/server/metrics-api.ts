// metrics-api.ts - Data loading and file watching for TELOS metrics

import { watch, existsSync, readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { homedir } from "os";
import { dirname, join } from "path";

// Types
export interface KpiConfig {
  id: string;
  name: string;
  description: string;
  goal_ref: string | null;
  type: "counter" | "duration" | "boolean" | "rating";
  target: number | boolean;
  frequency: "daily" | "weekly";
  unit?: string;
}

export interface MetricEntry {
  timestamp: string;
  kpi_id: string;
  value: number | boolean;
  goal_ref: string | null;
  note?: string;
}

export interface TelosGoal {
  id: string;
  content: string;
  category?: string;
}

export interface KpiProgress {
  kpi: KpiConfig;
  current: number;
  target: number;
  percentage: number;
  onTrack: boolean;
  streak: number;
  trend: number[];
}

export interface DashboardData {
  goals: TelosGoal[];
  kpis: KpiProgress[];
  alignmentScore: number;
  onTrackCount: number;
  totalCount: number;
  lastUpdated: string;
}

// Paths - go up from src/dashboard/server to pack root
const PACK_DIR = dirname(dirname(dirname(dirname(import.meta.path))));
const PAI_DIR = process.env.PAI_DIR || join(homedir(), ".claude");
const CONFIG_PATH = join(PACK_DIR, "data", "kpi-config.yaml");
const METRICS_PATH = join(PACK_DIR, "data", "metrics.jsonl");
const TELOS_PATH = join(PAI_DIR, "skills", "CORE", "USER", "TELOS.md");

// In-memory state
let kpiConfig: { kpis: KpiConfig[] } | null = null;
let metrics: MetricEntry[] = [];
let filePosition = 0;
let onUpdate: ((data: DashboardData) => void) | null = null;

/**
 * Load KPI configuration
 */
function loadConfig(): { kpis: KpiConfig[] } {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`KPI config not found: ${CONFIG_PATH}`);
    return { kpis: [] };
  }
  const content = readFileSync(CONFIG_PATH, "utf-8");
  return parseYaml(content) as { kpis: KpiConfig[] };
}

/**
 * Load all metrics from JSONL
 */
function loadAllMetrics(): MetricEntry[] {
  if (!existsSync(METRICS_PATH)) {
    return [];
  }

  const content = readFileSync(METRICS_PATH, "utf-8");
  filePosition = content.length;

  return content
    .split("\n")
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line) as MetricEntry;
      } catch {
        return null;
      }
    })
    .filter((m): m is MetricEntry => m !== null);
}

/**
 * Read new metrics since last position
 */
function readNewMetrics(): MetricEntry[] {
  if (!existsSync(METRICS_PATH)) return [];

  const content = readFileSync(METRICS_PATH, "utf-8");
  const newContent = content.slice(filePosition);
  filePosition = content.length;

  if (!newContent.trim()) return [];

  return newContent
    .trim()
    .split("\n")
    .map(line => {
      try {
        return JSON.parse(line) as MetricEntry;
      } catch {
        return null;
      }
    })
    .filter((m): m is MetricEntry => m !== null);
}

/**
 * Parse TELOS.md to extract goals
 */
function parseTelosGoals(): TelosGoal[] {
  if (!existsSync(TELOS_PATH)) {
    return [];
  }

  const content = readFileSync(TELOS_PATH, "utf-8");
  const goals: TelosGoal[] = [];
  const lines = content.split("\n");

  let currentCategory = "";

  for (const line of lines) {
    if (line.includes("Professional Goals")) {
      currentCategory = "Professional";
    } else if (line.includes("Personal Goals")) {
      currentCategory = "Personal";
    }

    const match = line.match(/\*\*G(\d+):\*\*\s*(.+)/);
    if (match) {
      goals.push({
        id: `G${match[1]}`,
        content: match[2].trim(),
        category: currentCategory || undefined
      });
    }
  }

  return goals;
}

/**
 * Get today's date string
 */
function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Calculate streak for a KPI
 */
function calculateStreak(kpiId: string, target: number): number {
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

/**
 * Calculate 7-day trend for a KPI
 */
function calculateTrend(kpiId: string): number[] {
  const trend: number[] = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dayStr = date.toISOString().split("T")[0];

    const dayMetrics = metrics.filter(
      m => m.kpi_id === kpiId && m.timestamp.startsWith(dayStr)
    );

    const value = dayMetrics.reduce(
      (acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)),
      0
    );

    trend.push(value);
  }

  return trend;
}

/**
 * Get current progress for all KPIs
 */
function getKpiProgress(): KpiProgress[] {
  if (!kpiConfig) return [];

  const todayStr = getTodayStr();

  return kpiConfig.kpis.map(kpi => {
    const todayMetrics = metrics.filter(
      m => m.kpi_id === kpi.id && m.timestamp.startsWith(todayStr)
    );

    const current = todayMetrics.reduce(
      (acc, m) => acc + (typeof m.value === "number" ? m.value : (m.value ? 1 : 0)),
      0
    );

    const targetNum = typeof kpi.target === "number" ? kpi.target : (kpi.target ? 1 : 0);
    const percentage = targetNum > 0 ? Math.min(Math.round((current / targetNum) * 100), 100) : 0;

    return {
      kpi,
      current,
      target: targetNum,
      percentage,
      onTrack: current >= targetNum,
      streak: calculateStreak(kpi.id, targetNum),
      trend: calculateTrend(kpi.id)
    };
  });
}

/**
 * Build complete dashboard data
 */
export function getDashboardData(): DashboardData {
  const goals = parseTelosGoals();
  const kpis = getKpiProgress();
  const onTrackCount = kpis.filter(k => k.onTrack).length;
  const totalCount = kpis.length;
  const alignmentScore = totalCount > 0 ? Math.round((onTrackCount / totalCount) * 100) : 0;

  return {
    goals,
    kpis,
    alignmentScore,
    onTrackCount,
    totalCount,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Get KPIs for a specific goal
 */
export function getKpisForGoal(goalId: string): KpiProgress[] {
  const allKpis = getKpiProgress();
  return allKpis.filter(k => k.kpi.goal_ref === goalId);
}

/**
 * Get recent metric entries
 */
export function getRecentMetrics(limit: number = 50): MetricEntry[] {
  return metrics.slice(-limit).reverse();
}

/**
 * Start watching metrics file
 */
export function startWatching(callback: (data: DashboardData) => void): void {
  onUpdate = callback;

  // Initial load
  kpiConfig = loadConfig();
  metrics = loadAllMetrics();

  console.log(`📊 Loaded ${kpiConfig.kpis.length} KPIs`);
  console.log(`📈 Loaded ${metrics.length} metric entries`);

  // Watch for changes
  if (existsSync(METRICS_PATH)) {
    console.log(`👀 Watching: ${METRICS_PATH}`);

    watch(METRICS_PATH, (eventType) => {
      if (eventType === "change") {
        const newMetrics = readNewMetrics();
        if (newMetrics.length > 0) {
          metrics.push(...newMetrics);
          console.log(`✅ Received ${newMetrics.length} new metric(s)`);

          if (onUpdate) {
            onUpdate(getDashboardData());
          }
        }
      }
    });
  }

  // Also watch config for changes
  if (existsSync(CONFIG_PATH)) {
    watch(CONFIG_PATH, (eventType) => {
      if (eventType === "change") {
        console.log("🔄 KPI config changed, reloading...");
        kpiConfig = loadConfig();
        if (onUpdate) {
          onUpdate(getDashboardData());
        }
      }
    });
  }
}
