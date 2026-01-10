#!/usr/bin/env bun
/**
 * AppleHealthSync.ts - Import Apple Health data from iOS Shortcut export
 *
 * Commands:
 *   sync              Import health data from iCloud sync file
 *   status            Show last sync information
 */

import { readFileSync, appendFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { dirname, join } from "path";
import { homedir } from "os";

// Types
interface HealthExport {
  date: string; // YYYY-MM-DD
  exported_at: string; // ISO timestamp
  metrics: {
    steps?: number;
    exercise_minutes?: number;
    sleep_hours?: number;
  };
}

interface KpiConfig {
  id: string;
  name: string;
  goal_ref: string | null;
  apple_health_id?: string;
}

interface KpiConfigFile {
  kpis: KpiConfig[];
}

interface MetricEntry {
  timestamp: string;
  kpi_id: string;
  value: number | boolean;
  goal_ref: string | null;
  note?: string;
  source?: string;
}

// Paths
const PACK_DIR = dirname(dirname(dirname(import.meta.path)));
const CONFIG_PATH = `${PACK_DIR}/data/kpi-config.yaml`;
const METRICS_PATH = `${PACK_DIR}/data/metrics.jsonl`;

// iCloud Drive path for health sync file
const ICLOUD_HEALTH_PATH = join(
  homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/PAI/health-sync.json"
);

// Mapping from health export keys to KPI IDs
const HEALTH_TO_KPI: Record<string, string> = {
  steps: "steps_count",
  exercise_minutes: "exercise_minutes",
  sleep_hours: "sleep_hours",
};

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
 * Load all metric entries
 */
function loadMetrics(): MetricEntry[] {
  if (!existsSync(METRICS_PATH)) {
    return [];
  }

  const content = readFileSync(METRICS_PATH, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MetricEntry);
}

/**
 * Check if a metric already exists for the given date, KPI, and source
 */
function metricExists(
  metrics: MetricEntry[],
  date: string,
  kpiId: string,
  source: string
): boolean {
  return metrics.some(
    (m) =>
      m.timestamp.startsWith(date) &&
      m.kpi_id === kpiId &&
      m.source === source
  );
}

/**
 * Load the health export file from iCloud
 */
function loadHealthExport(): HealthExport | null {
  if (!existsSync(ICLOUD_HEALTH_PATH)) {
    return null;
  }

  try {
    const content = readFileSync(ICLOUD_HEALTH_PATH, "utf-8");
    return JSON.parse(content) as HealthExport;
  } catch (error) {
    console.error("Failed to parse health export:", error);
    return null;
  }
}

/**
 * Import health metrics into the metrics log
 */
function syncHealthData(): { imported: number; skipped: number } {
  const healthData = loadHealthExport();

  if (!healthData) {
    console.error(`Health export file not found at: ${ICLOUD_HEALTH_PATH}`);
    console.log("\nTo set up Apple Health sync:");
    console.log("1. Create an iOS Shortcut that exports health data");
    console.log("2. Save the JSON to iCloud Drive/PAI/health-sync.json");
    console.log("\nRun 'bun run AppleHealthSync.ts setup' for detailed instructions.");
    return { imported: 0, skipped: 0 };
  }

  const config = loadConfig();
  const existingMetrics = loadMetrics();
  const date = healthData.date;

  let imported = 0;
  let skipped = 0;

  // Create timestamp at noon for the given date (avoids timezone edge cases)
  const timestamp = `${date}T12:00:00.000Z`;

  for (const [healthKey, value] of Object.entries(healthData.metrics)) {
    if (value === undefined || value === null) continue;

    const kpiId = HEALTH_TO_KPI[healthKey];
    if (!kpiId) {
      console.warn(`Unknown health metric: ${healthKey}`);
      continue;
    }

    // Check for existing entry
    if (metricExists(existingMetrics, date, kpiId, "apple_health")) {
      console.log(`  Skipped ${kpiId} for ${date} (already exists)`);
      skipped++;
      continue;
    }

    // Find the KPI config to get goal_ref
    const kpi = config.kpis.find((k) => k.id === kpiId);
    if (!kpi) {
      console.warn(`KPI not found in config: ${kpiId}`);
      continue;
    }

    // Create the metric entry
    const entry: MetricEntry = {
      timestamp,
      kpi_id: kpiId,
      value,
      goal_ref: kpi.goal_ref,
      source: "apple_health",
    };

    // Append to metrics file
    appendFileSync(METRICS_PATH, JSON.stringify(entry) + "\n");
    console.log(`  Imported ${kpiId}: ${value}`);
    imported++;
  }

  return { imported, skipped };
}

/**
 * Show sync status
 */
function showStatus(): void {
  const healthData = loadHealthExport();

  console.log("\nApple Health Sync Status\n");

  if (!healthData) {
    console.log("Status: Not configured");
    console.log(`Expected file: ${ICLOUD_HEALTH_PATH}`);
    return;
  }

  console.log(`Last export date: ${healthData.date}`);
  console.log(`Exported at: ${new Date(healthData.exported_at).toLocaleString()}`);
  console.log("\nMetrics in export:");

  for (const [key, value] of Object.entries(healthData.metrics)) {
    const kpiId = HEALTH_TO_KPI[key] || key;
    console.log(`  ${kpiId}: ${value}`);
  }

  // Check what's been imported
  const metrics = loadMetrics();
  const appleHealthMetrics = metrics.filter((m) => m.source === "apple_health");
  const latestByKpi = new Map<string, MetricEntry>();

  for (const m of appleHealthMetrics) {
    const existing = latestByKpi.get(m.kpi_id);
    if (!existing || m.timestamp > existing.timestamp) {
      latestByKpi.set(m.kpi_id, m);
    }
  }

  console.log("\nLast imported entries:");
  if (latestByKpi.size === 0) {
    console.log("  No Apple Health data imported yet");
  } else {
    for (const [kpiId, entry] of latestByKpi) {
      const date = entry.timestamp.split("T")[0];
      console.log(`  ${kpiId}: ${entry.value} (${date})`);
    }
  }
}

/**
 * Show setup instructions
 */
function showSetupInstructions(): void {
  console.log(`
Apple Health Sync Setup Instructions
=====================================

This tool imports health data from an iOS Shortcut export.

STEP 1: Create the iOS Shortcut
-------------------------------
1. Open the Shortcuts app on your iPhone
2. Tap + to create a new shortcut
3. Add these actions in order:

   a) "Find Health Samples" (for Steps)
      - Type: Steps
      - Start Date: "is in the last" → 1 day
      - Group by: Day
      - Fill Missing: Off

   b) "Set Variable"
      - Name it: Steps

   c) "Find Health Samples" (for Exercise)
      - Type: Exercise Time (or Apple Exercise Time)
      - Start Date: "is in the last" → 1 day
      - Group by: Day

   d) "Set Variable"
      - Name it: Exercise

   e) "Find Health Samples" (for Sleep)
      - Type: Sleep Analysis
      - Start Date: "is in the last" → 1 day

   f) "Set Variable"
      - Name it: Sleep

   g) "Date" action
      - Set to: Current Date

   h) "Adjust Date" action
      - Subtract 1 day (this gives yesterday's date)

   i) "Format Date" action
      - Format: Custom → yyyy-MM-dd
      - Set variable: YesterdayDate

   j) "Text" action - paste this template:
      {
        "date": "[YesterdayDate variable]",
        "exported_at": "[Current Date as ISO 8601]",
        "metrics": {
          "steps": [Steps variable],
          "exercise_minutes": [Exercise variable],
          "sleep_hours": [Sleep variable]
        }
      }

      (Tap each bracketed item and replace with the matching variable)

   k) "Save File" action
      - Destination: iCloud Drive
      - Path: PAI/health-sync.json
      - Overwrite: Yes

4. Name the shortcut "Export Health to PAI"

STEP 2: Create PAI Folder (on Mac)
----------------------------------
Run this command in Terminal:
  mkdir -p ~/Library/Mobile\\ Documents/com~apple~CloudDocs/PAI

STEP 3: Test the Shortcut
-------------------------
1. Run the shortcut manually on your iPhone
2. Wait for iCloud to sync (a few seconds)
3. On Mac, run: bun run AppleHealthSync.ts sync

STEP 4: Set Up Daily Automation (optional)
------------------------------------------
1. Go to Shortcuts > Automation tab
2. Tap + > Create Personal Automation
3. Choose "Time of Day" - set to morning (e.g., 8:00 AM)
4. Add action: Run Shortcut > "Export Health to PAI"
5. Note: You may need to confirm the automation runs
   (Health data requires phone to be unlocked)

IMPORTANT NOTES
---------------
- Apple Health data can only be read while your phone is unlocked
- The shortcut must be run manually or you must respond to the
  automation prompt - true background automation isn't possible
- Sleep data may return in different units depending on your
  settings - you may need to convert to hours

Expected file location:
  ${ICLOUD_HEALTH_PATH}

For more info:
  https://support.apple.com/guide/shortcuts/intro-to-find-and-filter-actions-apd3c845e881/ios
`);
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "sync": {
        console.log("Syncing Apple Health data...\n");
        const result = syncHealthData();
        console.log(`\nDone: ${result.imported} imported, ${result.skipped} skipped`);
        break;
      }

      case "status": {
        showStatus();
        break;
      }

      case "setup": {
        showSetupInstructions();
        break;
      }

      default:
        console.log("Apple Health Sync\n");
        console.log("Commands:");
        console.log("  sync     Import health data from iCloud sync file");
        console.log("  status   Show last sync information");
        console.log("  setup    Show iOS Shortcut setup instructions");
        console.log(`\nExpected file: ${ICLOUD_HEALTH_PATH}`);
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
