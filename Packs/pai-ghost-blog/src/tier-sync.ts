/**
 * tier-sync.ts — Sync command for tier-cli
 *
 * Reads a manifest.json from a tier-dir, regenerates tier files from source,
 * and updates Ghost drafts with the new content.
 *
 * Usage:
 *   tier-cli sync <tier-dir> [--dry-run] [--skip-generate] [--skip-publish]
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { generateTiers } from "./tier-generator.js";
import { updateTiers } from "./tier-publisher.js";
import { ALL_TIERS, type Tier, type TierManifest } from "./tier-types.js";

// ============================================================================
// Helpers
// ============================================================================

function tierBadge(tier: string): string {
  switch (tier) {
    case "free":    return chalk.cyan("[FREE]");
    case "starter": return chalk.yellow("[STARTER]");
    case "pro":     return chalk.magenta("[PRO]");
    default:        return `[${tier.toUpperCase()}]`;
  }
}

function spinner(label: string): NodeJS.Timeout {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  return setInterval(() => {
    process.stdout.write(`\r${chalk.dim(frames[i++ % frames.length])} ${label}`);
  }, 80);
}

function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

// ============================================================================
// Manifest I/O
// ============================================================================

export function readManifest(manifestPath: string): TierManifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found: ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  try {
    return JSON.parse(raw) as TierManifest;
  } catch {
    throw new Error(`Invalid JSON in manifest: ${manifestPath}`);
  }
}

export function writeManifest(manifestPath: string, manifest: TierManifest): void {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

// ============================================================================
// Sync entry point
// ============================================================================

export interface SyncOptions {
  tierDir: string;
  dryRun: boolean;
  skipGenerate: boolean;
  skipPublish: boolean;
}

export async function runSync(opts: SyncOptions): Promise<void> {
  const resolvedDir = path.resolve(opts.tierDir);

  if (!fs.existsSync(resolvedDir)) {
    console.error(chalk.red(`Directory not found: ${resolvedDir}`));
    process.exit(2);
  }

  const manifestPath = path.join(resolvedDir, "manifest.json");
  let manifest: TierManifest;

  try {
    manifest = readManifest(manifestPath);
  } catch (err) {
    console.error(chalk.red(`❌ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(2);
  }

  const sourceFile = path.resolve(resolvedDir, manifest.source);

  console.log(chalk.bold(`\n🔄 tier-cli sync`));
  console.log(chalk.dim(`   Tier dir: ${resolvedDir}`));
  console.log(chalk.dim(`   Source:   ${sourceFile}`));
  console.log(chalk.dim(`   Ghost IDs: ${Object.entries(manifest.ghost).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`));
  if (opts.dryRun) {
    console.log(chalk.yellow(`   ⚠️  DRY RUN — no files will be written or posts updated\n`));
  } else {
    console.log();
  }

  // ── Step 1: Generate ──────────────────────────────────────────────────────

  if (!opts.skipGenerate) {
    if (!fs.existsSync(sourceFile)) {
      console.error(chalk.red(`❌ Source file not found: ${sourceFile}`));
      process.exit(2);
    }

    console.log(chalk.bold("  📝 Generating tier files..."));

    let activeSpinner: NodeJS.Timeout | null = null;

    try {
      if (!opts.dryRun) {
        const result = await generateTiers(
          { inputFile: sourceFile, outputDir: resolvedDir, tiers: [...ALL_TIERS] },
          (tier: Tier, status: "start" | "done" | "error") => {
            if (status === "start") {
              activeSpinner = spinner(`  Generating ${tierBadge(tier)} tier...`);
            } else {
              if (activeSpinner) { clearInterval(activeSpinner); activeSpinner = null; }
              clearLine();
              const icon = status === "done" ? chalk.green("✅") : chalk.red("❌");
              console.log(`    ${icon} ${tierBadge(tier)}`);
            }
          }
        );
        console.log(chalk.dim(`  Generated ${result.tiers.length} tier file(s) in ${resolvedDir}\n`));
      } else {
        // Dry-run: just report what would be generated
        for (const tier of ALL_TIERS) {
          const outFile = path.join(resolvedDir, `${tier}.md`);
          console.log(`    ${chalk.dim("→")} ${tierBadge(tier)} ${chalk.dim(outFile)} ${chalk.yellow("(dry run)")}`);
        }
        console.log();
      }
    } catch (err) {
      if (activeSpinner) { clearInterval(activeSpinner); }
      clearLine();
      console.error(chalk.red(`\n❌ Generate error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  } else {
    console.log(chalk.dim("  ⏭  Skipping generate (--skip-generate)\n"));
  }

  // ── Step 2: Publish (update Ghost drafts) ─────────────────────────────────

  if (!opts.skipPublish) {
    const ghostIds = manifest.ghost as Partial<Record<string, string>>;
    const tiersWithIds = Object.entries(ghostIds).filter(([, v]) => !!v);

    if (tiersWithIds.length === 0) {
      console.log(chalk.dim("  ℹ️  No Ghost IDs in manifest — skipping publish step\n"));
    } else {
      console.log(chalk.bold("  🚀 Updating Ghost drafts..."));

      let activeSpinner: NodeJS.Timeout | null = null;

      try {
        if (!opts.dryRun) {
          activeSpinner = spinner("  Resolving k8s credentials...");
        }

        const results = await updateTiers({
          tierDir: resolvedDir,
          ghostIds,
          dryRun: opts.dryRun,
        });

        if (activeSpinner) { clearInterval(activeSpinner); activeSpinner = null; clearLine(); }

        for (const r of results) {
          if (r.skipped) {
            console.log(`    ${chalk.yellow("⚠️ ")} ${tierBadge(r.tier)} ${chalk.dim(r.title)}`);
          } else if (opts.dryRun) {
            console.log(`    ${chalk.dim("→")} ${tierBadge(r.tier)} ${chalk.white(r.title)} ${chalk.dim(`(post ${r.postId})`)} ${chalk.yellow("(dry run)")}`);
          } else {
            console.log(`    ${chalk.green("✅")} ${tierBadge(r.tier)} ${chalk.white(r.title)}`);
            if (r.editorUrl) console.log(chalk.cyan(`         ${r.editorUrl}`));
          }
        }
        console.log();
      } catch (err) {
        if (activeSpinner) { clearInterval(activeSpinner); clearLine(); }
        console.error(chalk.red(`\n❌ Publish error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    }
  } else {
    console.log(chalk.dim("  ⏭  Skipping publish (--skip-publish)\n"));
  }

  // ── Step 3: Update manifest.lastSync ──────────────────────────────────────

  if (!opts.dryRun) {
    manifest.lastSync = new Date().toISOString();
    writeManifest(manifestPath, manifest);
    console.log(chalk.dim(`  ✏️  Updated manifest.lastSync → ${manifest.lastSync}`));
  }

  console.log(chalk.bold(`\n${opts.dryRun ? "🔍 Dry run complete" : "✨ Sync complete"}\n`));
}
