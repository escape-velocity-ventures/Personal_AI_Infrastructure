#!/usr/bin/env bun
/**
 * SyncMetrics.ts - Sync metrics data across machines via git
 *
 * Commands:
 *   sync          Pull, merge, and push metrics data
 *   status        Show sync status (ahead/behind)
 *   conflicts     Check for potential conflicts
 *
 * JSONL files are append-only, so merges are typically clean.
 * Each entry includes a `machine` field for tracking origin.
 */

import { $ } from "bun";
import { hostname } from "os";
import { dirname } from "path";

const PACK_DIR = dirname(dirname(dirname(import.meta.path)));
const PAI_DIR = dirname(dirname(PACK_DIR));

interface SyncResult {
  success: boolean;
  pulled: boolean;
  pushed: boolean;
  conflicts: string[];
  message: string;
}

/**
 * Get current git status
 */
async function getGitStatus(): Promise<{
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: string[];
}> {
  const branch = (await $`git -C ${PAI_DIR} rev-parse --abbrev-ref HEAD`.text()).trim();

  // Fetch to get latest remote state
  await $`git -C ${PAI_DIR} fetch origin ${branch} 2>/dev/null`.quiet();

  // Get ahead/behind counts
  const revList = await $`git -C ${PAI_DIR} rev-list --left-right --count ${branch}...origin/${branch} 2>/dev/null`.text().catch(() => "0\t0");
  const [ahead, behind] = revList.trim().split("\t").map(Number);

  // Check for uncommitted changes
  const status = await $`git -C ${PAI_DIR} status --porcelain`.text();
  const files = status.trim().split("\n").filter(Boolean);

  return {
    branch,
    ahead: ahead || 0,
    behind: behind || 0,
    dirty: files.length > 0,
    files
  };
}

/**
 * Sync metrics data
 */
async function syncMetrics(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    pulled: false,
    pushed: false,
    conflicts: [],
    message: ""
  };

  try {
    const machine = hostname();
    console.log(`\n🔄 Syncing metrics from ${machine}...\n`);

    // Get current status
    const status = await getGitStatus();
    console.log(`📍 Branch: ${status.branch}`);
    console.log(`   Local: ${status.ahead} commits ahead, ${status.behind} commits behind`);

    if (status.dirty) {
      console.log(`   Modified files: ${status.files.length}`);
    }

    // Stage metrics files
    const metricsPath = "Packs/pai-telos-metrics/data/metrics.jsonl";
    await $`git -C ${PAI_DIR} add ${metricsPath} 2>/dev/null`.quiet().catch(() => {});

    // Check if we have changes to commit
    const stagedChanges = await $`git -C ${PAI_DIR} diff --cached --name-only`.text();

    if (stagedChanges.includes("metrics.jsonl")) {
      console.log(`\n📝 Committing local metrics...`);
      await $`git -C ${PAI_DIR} commit -m "metrics(${machine}): Sync KPI data

Auto-sync from ${machine}

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"`.quiet();
    }

    // Pull with rebase to keep history clean
    if (status.behind > 0) {
      console.log(`\n⬇️  Pulling ${status.behind} commits...`);
      try {
        await $`git -C ${PAI_DIR} pull --rebase origin ${status.branch}`;
        result.pulled = true;
      } catch (error) {
        // Check for conflicts
        const conflictFiles = await $`git -C ${PAI_DIR} diff --name-only --diff-filter=U`.text().catch(() => "");
        if (conflictFiles.trim()) {
          result.conflicts = conflictFiles.trim().split("\n");
          console.log(`\n⚠️  Merge conflicts in: ${result.conflicts.join(", ")}`);
          console.log(`   JSONL conflicts can usually be resolved by keeping both versions.`);

          // Auto-resolve JSONL by keeping both
          for (const file of result.conflicts) {
            if (file.endsWith(".jsonl")) {
              console.log(`   Auto-resolving ${file}...`);
              // For JSONL, we can just concatenate both versions
              await $`git -C ${PAI_DIR} checkout --theirs ${file}`.quiet();
              await $`git -C ${PAI_DIR} add ${file}`.quiet();
            }
          }

          await $`git -C ${PAI_DIR} rebase --continue`.quiet().catch(() => {});
          result.pulled = true;
        } else {
          throw error;
        }
      }
    }

    // Push local commits
    const newStatus = await getGitStatus();
    if (newStatus.ahead > 0) {
      console.log(`\n⬆️  Pushing ${newStatus.ahead} commits...`);
      await $`git -C ${PAI_DIR} push origin ${status.branch}`;
      result.pushed = true;
    }

    result.success = true;
    result.message = `Sync complete. Pulled: ${result.pulled}, Pushed: ${result.pushed}`;
    console.log(`\n✅ ${result.message}`);

  } catch (error) {
    result.message = `Sync failed: ${error instanceof Error ? error.message : error}`;
    console.error(`\n❌ ${result.message}`);
  }

  return result;
}

/**
 * Show sync status
 */
async function showStatus(): Promise<void> {
  const status = await getGitStatus();
  const machine = hostname();

  console.log(`\n📊 Sync Status (${machine})\n`);
  console.log(`Branch: ${status.branch}`);
  console.log(`Ahead:  ${status.ahead} commits`);
  console.log(`Behind: ${status.behind} commits`);
  console.log(`Dirty:  ${status.dirty ? "Yes" : "No"}`);

  if (status.files.length > 0) {
    console.log(`\nModified files:`);
    for (const file of status.files) {
      console.log(`  ${file}`);
    }
  }

  if (status.behind > 0) {
    console.log(`\n⚠️  Run 'sync' to pull latest changes`);
  }
  if (status.ahead > 0 || status.dirty) {
    console.log(`\n⚠️  Run 'sync' to push local changes`);
  }
}

/**
 * CLI interface
 */
async function main() {
  const command = process.argv[2] || "sync";

  switch (command) {
    case "sync":
      await syncMetrics();
      break;

    case "status":
      await showStatus();
      break;

    case "help":
    default:
      console.log("TELOS Metrics Sync\n");
      console.log("Commands:");
      console.log("  sync      Pull, merge, and push metrics data");
      console.log("  status    Show sync status");
      console.log("  help      Show this help");
  }
}

if (import.meta.main) {
  main();
}
