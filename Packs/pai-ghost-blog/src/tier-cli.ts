#!/usr/bin/env bun

/**
 * tier-cli — AI-powered tier generation engine
 *
 * Commands:
 *   generate <input.md> [--output-dir <dir>] [--tiers free,starter,pro]
 *   batch    <dir>      [--output-dir <dir>] [--tiers free,starter,pro]
 *
 * Exit codes:
 *   0 — success
 *   1 — generation error
 *   2 — bad arguments / setup error
 */

import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import { generateTiers, batchGenerateTiers } from "./tier-generator.js";
import { ALL_TIERS, type Tier, type TierManifest } from "./tier-types.js";
import { publishTiers } from "./tier-publisher.js";
import { runSync, readManifest, writeManifest } from "./tier-sync.js";
import { createBackend, listPlatforms, type SocialPost } from "./social/index.js";
import { scheduleRun, schedulePreview, scheduleStatus } from "./tier-scheduler.js";

const VERSION = "0.2.0";

// ============================================================================
// Helpers
// ============================================================================

function parseTiers(input: string): Tier[] {
  const valid = new Set<Tier>(["free", "starter", "pro"]);
  const requested = input.split(",").map((s) => s.trim().toLowerCase()) as Tier[];
  for (const t of requested) {
    if (!valid.has(t)) {
      console.error(chalk.red(`Invalid tier: "${t}". Valid values: free, starter, pro`));
      process.exit(2);
    }
  }
  return requested;
}

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
  const id = setInterval(() => {
    process.stdout.write(`\r${chalk.dim(frames[i++ % frames.length])} ${label}`);
  }, 80);
  return id;
}

function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

// ============================================================================
// CLI
// ============================================================================

const program = new Command()
  .name("tier-cli")
  .version(VERSION)
  .description("tier-cli — AI-powered tier generation engine")
  .addHelpText(
    "after",
    `
Examples:
  tier-cli generate post.md
  tier-cli generate post.md --output-dir ./output --tiers free,starter
  tier-cli generate post.md --manifest ./post-tiers/manifest.json
  tier-cli batch ./posts --output-dir ./output
  tier-cli batch ./posts --tiers pro
  tier-cli sync ./post-34-tiers
  tier-cli sync ./post-34-tiers --dry-run --skip-generate
`
  );

// ============================================================================
// generate command
// ============================================================================

program
  .command("generate <input>")
  .description("Generate tier content from a single markdown file")
  .option(
    "--output-dir <dir>",
    "Directory to write generated files (default: <input-stem>/)"
  )
  .option(
    "--tiers <list>",
    "Comma-separated list of tiers to generate (default: free,starter,pro)"
  )
  .option(
    "--manifest <path>",
    "Write or update a manifest.json at this path after generation"
  )
  .action(async (input: string, opts: { outputDir?: string; tiers?: string; manifest?: string }) => {
    const inputFile = path.resolve(input);
    if (!fs.existsSync(inputFile)) {
      console.error(chalk.red(`File not found: ${inputFile}`));
      process.exit(2);
    }

    const stem = path.basename(inputFile, ".md");
    const outputDir = opts.outputDir
      ? path.resolve(opts.outputDir)
      : path.join(path.dirname(inputFile), stem);

    const tiers: Tier[] = opts.tiers ? parseTiers(opts.tiers) : [...ALL_TIERS];

    console.log(chalk.bold(`\n📝 tier-cli generate`));
    console.log(chalk.dim(`   Input:  ${inputFile}`));
    console.log(chalk.dim(`   Output: ${outputDir}`));
    console.log(chalk.dim(`   Tiers:  ${tiers.join(", ")}\n`));

    let activeSpinner: NodeJS.Timeout | null = null;
    let currentTier = "";

    try {
      const result = await generateTiers(
        { inputFile, outputDir, tiers },
        (tier, status) => {
          if (status === "start") {
            currentTier = tier;
            activeSpinner = spinner(`Generating ${tierBadge(tier)} tier...`);
          } else if (status === "done") {
            if (activeSpinner) { clearInterval(activeSpinner); activeSpinner = null; }
            clearLine();
            console.log(`  ${chalk.green("✅")} ${tierBadge(tier)} done`);
          } else {
            if (activeSpinner) { clearInterval(activeSpinner); activeSpinner = null; }
            clearLine();
            console.log(`  ${chalk.red("❌")} ${tierBadge(tier)} error`);
          }
        }
      );

      console.log(chalk.bold(`\n✨ Generated ${result.tiers.length} tier(s)`));
      for (const t of result.tiers) {
        const outFile = path.join(outputDir, `${t.tier}.md`);
        console.log(`  ${tierBadge(t.tier)} ${chalk.dim(outFile)} ${chalk.dim(`(~${t.wordCount} words)`)}`);
      }

      // Write/update manifest if requested
      if (opts.manifest) {
        const manifestPath = path.resolve(opts.manifest);
        let manifest: TierManifest = { source: path.relative(outputDir, inputFile), ghost: {} };
        try {
          manifest = readManifest(manifestPath);
        } catch {
          // manifest doesn't exist yet — use fresh one
        }
        manifest.source = path.relative(path.dirname(manifestPath), inputFile);
        writeManifest(manifestPath, manifest);
        console.log(chalk.dim(`\n  📋 Manifest written: ${manifestPath}`));
      }

      console.log();
    } catch (err) {
      if (activeSpinner) { clearInterval(activeSpinner); }
      clearLine();
      console.error(chalk.red(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// ============================================================================
// batch command
// ============================================================================

program
  .command("batch <dir>")
  .description("Generate tier content for all markdown files in a directory")
  .option("--output-dir <dir>", "Base output directory (each file gets a subdirectory)")
  .option(
    "--tiers <list>",
    "Comma-separated list of tiers to generate (default: free,starter,pro)"
  )
  .option("--limit <n>", "Process at most N files (useful for cost control)", parseInt)
  .option(
    "--skip-existing",
    "Skip files whose output directory already contains at least one tier file (free.md, starter.md, or pro.md)"
  )
  .action(async (dir: string, opts: { outputDir?: string; tiers?: string; limit?: number; skipExisting?: boolean }) => {
    const inputDir = path.resolve(dir);
    if (!fs.existsSync(inputDir)) {
      console.error(chalk.red(`Directory not found: ${inputDir}`));
      process.exit(2);
    }

    const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : path.join(inputDir, "output");
    const tiers: Tier[] = opts.tiers ? parseTiers(opts.tiers) : [...ALL_TIERS];

    let files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) {
      console.error(chalk.red(`No markdown files found in: ${inputDir}`));
      process.exit(2);
    }

    // --skip-existing: filter out files whose output dir already has tier content
    let skippedExisting = 0;
    if (opts.skipExisting) {
      files = files.filter((f) => {
        const stem = path.basename(f, ".md");
        const fileOutputDir = path.join(outputDir, stem);
        const hasExisting = ["free", "starter", "pro"].some((tier) =>
          fs.existsSync(path.join(fileOutputDir, `${tier}.md`))
        );
        if (hasExisting) skippedExisting++;
        return !hasExisting;
      });
    }

    // --limit: cap the number of files to process
    const originalCount = files.length;
    if (opts.limit !== undefined && opts.limit > 0) {
      files = files.slice(0, opts.limit);
    }

    if (files.length === 0) {
      console.log(chalk.yellow(`\n⚠️  No files to process`));
      if (skippedExisting > 0) {
        console.log(chalk.dim(`   (${skippedExisting} file(s) skipped — existing tiers found)`));
      }
      process.exit(0);
    }

    console.log(chalk.bold(`\n📦 tier-cli batch`));
    console.log(chalk.dim(`   Input:  ${inputDir} (${files.length} of ${originalCount + skippedExisting} files)`));
    console.log(chalk.dim(`   Output: ${outputDir}`));
    console.log(chalk.dim(`   Tiers:  ${tiers.join(", ")}`));
    if (skippedExisting > 0) {
      console.log(chalk.dim(`   Skipped (existing): ${skippedExisting}`));
    }
    if (opts.limit !== undefined && originalCount > files.length) {
      console.log(chalk.dim(`   Limited to: ${files.length} (--limit ${opts.limit})`));
    }
    console.log();

    let activeSpinner: NodeJS.Timeout | null = null;

    try {
      const results = await batchGenerateTiers(
        { inputDir, outputDir, tiers },
        (file, tier, status) => {
          const label = `${chalk.dim(file)} → ${tierBadge(tier)}`;
          if (status === "start") {
            activeSpinner = spinner(`Generating ${label}...`);
          } else if (status === "done") {
            if (activeSpinner) { clearInterval(activeSpinner); activeSpinner = null; }
            clearLine();
            console.log(`  ${chalk.green("✅")} ${label}`);
          } else {
            if (activeSpinner) { clearInterval(activeSpinner); activeSpinner = null; }
            clearLine();
            console.log(`  ${chalk.red("❌")} ${label}`);
          }
        }
      );

      const totalTiers = results.reduce((sum, r) => sum + r.tiers.length, 0);
      console.log(chalk.bold(`\n✨ Batch complete: ${results.length} file(s), ${totalTiers} tier(s) generated`));
      for (const r of results) {
        console.log(`  ${chalk.dim(r.sourceFilename)} → ${r.tiers.map((t) => tierBadge(t.tier)).join(" ")}`);
      }
      console.log();
    } catch (err) {
      if (activeSpinner) { clearInterval(activeSpinner); }
      clearLine();
      console.error(chalk.red(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// ============================================================================
// publish command
// ============================================================================

program
  .command("publish <tier-dir>")
  .description("Publish tier files (free.md, starter.md, pro.md) to Ghost as drafts")
  .option("--ghost-post-id <id>", "Source Ghost post ID to reference in tags")
  .option("--dry-run", "Show what would be published without creating posts")
  .addHelpText(
    "after",
    `
Visibility mapping:
  free.md    → public   (visible to everyone)
  starter.md → members  (free members only)
  pro.md     → paid     (paid members only)

Credentials are resolved automatically from k8s secrets:
  ghost-admin-api                (infrastructure namespace)
  cloudflare-ghost-access-token  (infrastructure namespace)

Examples:
  tier-cli publish ./my-post-output
  tier-cli publish ./my-post-output --ghost-post-id abc123def
  tier-cli publish ./my-post-output --dry-run
`
  )
  .action(
    async (
      tierDir: string,
      opts: { ghostPostId?: string; dryRun?: boolean }
    ) => {
      const resolvedDir = path.resolve(tierDir);
      if (!fs.existsSync(resolvedDir)) {
        console.error(chalk.red(`Directory not found: ${resolvedDir}`));
        process.exit(2);
      }

      const dryRun = opts.dryRun ?? false;

      console.log(chalk.bold(`\n🚀 tier-cli publish`));
      console.log(chalk.dim(`   Tier dir: ${resolvedDir}`));
      if (opts.ghostPostId) {
        console.log(chalk.dim(`   Source post ID: ${opts.ghostPostId}`));
      }
      if (dryRun) {
        console.log(chalk.yellow(`   ⚠️  DRY RUN — no posts will be created\n`));
      } else {
        console.log();
      }

      let activeSpinner: NodeJS.Timeout | null = null;

      try {
        if (!dryRun) {
          activeSpinner = spinner("Resolving k8s credentials...");
        }

        const results = await publishTiers({
          tierDir: resolvedDir,
          ghostPostId: opts.ghostPostId,
          dryRun,
        });

        if (activeSpinner) {
          clearInterval(activeSpinner);
          activeSpinner = null;
          clearLine();
        }

        if (dryRun) {
          console.log(chalk.bold("Dry-run preview:\n"));
          for (const r of results) {
            if (r.skipped) {
              console.log(`  ${chalk.red("⚠️ ")} ${tierBadge(r.tier)} ${chalk.dim("(file not found — skipped)")}`);
            } else {
              console.log(`  ${tierBadge(r.tier)} ${chalk.white(r.title)}`);
              console.log(chalk.dim(`         visibility: ${r.visibility}`));
            }
          }
          console.log(chalk.dim(`\n  (No posts created — dry run)\n`));
        } else {
          console.log(chalk.bold("Published drafts:\n"));
          for (const r of results) {
            if (r.skipped) {
              console.log(`  ${chalk.yellow("⚠️ ")} ${tierBadge(r.tier)} ${chalk.dim("skipped — file not found")}`);
            } else {
              console.log(`  ${chalk.green("✅")} ${tierBadge(r.tier)} ${chalk.white(r.title)}`);
              console.log(chalk.dim(`         visibility: ${r.visibility}`));
              console.log(chalk.cyan(`         ${r.editorUrl}`));
            }
          }

          // Update manifest.json with Ghost IDs if it exists in tierDir
          const manifestPath = path.join(resolvedDir, "manifest.json");
          const publishedTiers = results.filter((r) => !r.skipped && r.postId);
          if (publishedTiers.length > 0) {
            let manifest: TierManifest = { source: "", ghost: {} };
            try {
              manifest = readManifest(manifestPath);
            } catch {
              // no existing manifest — create one
            }
            for (const r of publishedTiers) {
              (manifest.ghost as Record<string, string>)[r.tier] = r.postId!;
            }
            writeManifest(manifestPath, manifest);
            console.log(chalk.dim(`\n  📋 Manifest updated with Ghost IDs: ${manifestPath}`));
          }

          console.log();
        }
      } catch (err) {
        if (activeSpinner) {
          clearInterval(activeSpinner);
          clearLine();
        }
        console.error(
          chalk.red(
            `\n❌ Error: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        process.exit(1);
      }
    }
  );

// ============================================================================
// sync command
// ============================================================================

program
  .command("sync <tier-dir>")
  .description("Sync a tier-dir: regenerate from source and update Ghost drafts via manifest.json")
  .option("--dry-run", "Show what would be generated/updated without making changes")
  .option("--skip-generate", "Skip the generate step (use existing tier files)")
  .option("--skip-publish", "Skip the Ghost publish/update step")
  .addHelpText(
    "after",
    `
manifest.json format:
  {
    "source": "../source-post.md",   // relative path to source markdown
    "ghost": {
      "free": "<Ghost post ID>",
      "starter": "<Ghost post ID>",
      "pro": "<Ghost post ID>"
    },
    "lastSync": "<ISO timestamp>"    // auto-updated on each sync
  }

Examples:
  tier-cli sync ./post-34-tiers
  tier-cli sync ./post-34-tiers --dry-run
  tier-cli sync ./post-34-tiers --skip-generate
  tier-cli sync ./post-34-tiers --dry-run --skip-generate
`
  )
  .action(
    async (
      tierDir: string,
      opts: { dryRun?: boolean; skipGenerate?: boolean; skipPublish?: boolean }
    ) => {
      await runSync({
        tierDir,
        dryRun: opts.dryRun ?? false,
        skipGenerate: opts.skipGenerate ?? false,
        skipPublish: opts.skipPublish ?? false,
      });
    }
  );

// ============================================================================
// schedule command group
// ============================================================================

const schedule = program
  .command("schedule")
  .description("Content calendar scheduling engine");

schedule
  .command("run [calendar]")
  .description("Execute due publications from the content calendar")
  .option("--dry-run", "Preview what would publish without executing")
  .option("--window <minutes>", "Window in minutes to check for due posts (default: 15)", parseInt)
  .action(async (calendar: string | undefined, opts: { dryRun?: boolean; window?: number }) => {
    const calendarPath = path.resolve(calendar ?? "content-calendar.yaml");
    if (!fs.existsSync(calendarPath)) {
      console.error(chalk.red(`Calendar not found: ${calendarPath}`));
      process.exit(2);
    }
    await scheduleRun({
      calendarPath,
      dryRun: opts.dryRun ?? false,
      window: opts.window ? { minutes: opts.window } : undefined,
    });
  });

schedule
  .command("preview [calendar]")
  .description("Show upcoming publications for the next 7 days")
  .action(async (calendar: string | undefined) => {
    const calendarPath = path.resolve(calendar ?? "content-calendar.yaml");
    if (!fs.existsSync(calendarPath)) {
      console.error(chalk.red(`Calendar not found: ${calendarPath}`));
      process.exit(2);
    }
    await schedulePreview(calendarPath);
  });

schedule
  .command("status [calendar]")
  .description("Show published/pending/failed status for all calendar entries")
  .action(async (calendar: string | undefined) => {
    const calendarPath = path.resolve(calendar ?? "content-calendar.yaml");
    if (!fs.existsSync(calendarPath)) {
      console.error(chalk.red(`Calendar not found: ${calendarPath}`));
      process.exit(2);
    }
    await scheduleStatus(calendarPath);
  });

// ============================================================================
// social command group
// ============================================================================

const social = program
  .command("social")
  .description("Social media publishing and analytics");

social
  .command("platforms")
  .description("List configured social platforms")
  .action(() => {
    const platforms = listPlatforms();
    console.log(chalk.bold("\n📱 Configured platforms:\n"));
    for (const p of platforms) {
      console.log(`  • ${p}`);
    }
    console.log();
  });

social
  .command("publish <platform> <file>")
  .description("Publish a markdown file as a social post")
  .option("--dry-run", "Show what would be published without posting")
  .action(async (platform: string, file: string, opts: { dryRun?: boolean }) => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(2);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const post = markdownToPost(content);

    console.log(chalk.bold(`\n📤 tier-cli social publish`));
    console.log(chalk.dim(`   Platform: ${platform}`));
    console.log(chalk.dim(`   File:     ${filePath}`));
    console.log(chalk.dim(`   Text:     ${post.text.slice(0, 100)}${post.text.length > 100 ? "…" : ""}`));
    if (post.hashtags?.length) console.log(chalk.dim(`   Tags:     ${post.hashtags.join(", ")}`));
    console.log();

    if (opts.dryRun) {
      console.log(chalk.yellow("  ⚠️  DRY RUN — no post created\n"));
      console.log(chalk.dim("  Post content:"));
      console.log(chalk.dim(`  ${post.text}\n`));
      return;
    }

    try {
      const backend = await createBackend(platform);
      const result = await backend.publish(post);
      console.log(chalk.green(`  ✅ Published!`));
      console.log(chalk.dim(`     Post ID: ${result.postId}`));
      console.log(chalk.cyan(`     URL:     ${result.url}`));
      console.log();
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

social
  .command("schedule <platform> <file>")
  .description("Schedule a social post for later")
  .requiredOption("--at <datetime>", "ISO datetime to publish at")
  .option("--dry-run", "Show what would be scheduled without posting")
  .action(async (platform: string, file: string, opts: { at: string; dryRun?: boolean }) => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(2);
    }

    const publishAt = new Date(opts.at);
    if (isNaN(publishAt.getTime())) {
      console.error(chalk.red(`Invalid datetime: ${opts.at}`));
      process.exit(2);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const post = markdownToPost(content);

    console.log(chalk.bold(`\n⏰ tier-cli social schedule`));
    console.log(chalk.dim(`   Platform:   ${platform}`));
    console.log(chalk.dim(`   File:       ${filePath}`));
    console.log(chalk.dim(`   Publish at: ${publishAt.toISOString()}`));
    console.log();

    if (opts.dryRun) {
      console.log(chalk.yellow("  ⚠️  DRY RUN — no post scheduled\n"));
      return;
    }

    try {
      const backend = await createBackend(platform);
      const result = await backend.schedule(post, publishAt);
      console.log(chalk.green(`  ✅ Scheduled!`));
      console.log(chalk.dim(`     Post ID: ${result.postId}`));
      console.log(chalk.cyan(`     URL:     ${result.url}`));
      console.log();
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

social
  .command("metrics <platform> <post-id>")
  .description("Get engagement metrics for a social post")
  .option("--dry-run", "Show what would be fetched without calling API")
  .action(async (platform: string, postId: string, opts: { dryRun?: boolean }) => {
    console.log(chalk.bold(`\n📊 tier-cli social metrics`));
    console.log(chalk.dim(`   Platform: ${platform}`));
    console.log(chalk.dim(`   Post ID:  ${postId}`));
    console.log();

    if (opts.dryRun) {
      console.log(chalk.yellow("  ⚠️  DRY RUN — would fetch metrics for this post\n"));
      return;
    }

    try {
      const backend = await createBackend(platform);
      const m = await backend.metrics(postId);
      console.log(`  Impressions:     ${m.impressions.toLocaleString()}`);
      console.log(`  Clicks:          ${m.clicks.toLocaleString()}`);
      console.log(`  Likes:           ${m.likes.toLocaleString()}`);
      console.log(`  Shares:          ${m.shares.toLocaleString()}`);
      console.log(`  Comments:        ${m.comments.toLocaleString()}`);
      console.log(`  Engagement Rate: ${m.engagementRate.toFixed(2)}%`);
      console.log();
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// ============================================================================
// Helpers — markdown to social post
// ============================================================================

function markdownToPost(content: string): SocialPost {
  // Strip YAML frontmatter
  let body = content;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    body = fmMatch[2];
  }

  // Extract hashtags from the content (lines starting with tags)
  const hashtags: string[] = [];
  const tagMatch = body.match(/(?:^|\n)(?:tags|hashtags):\s*(.+)/i);
  if (tagMatch) {
    hashtags.push(
      ...tagMatch[1].split(/[,\s]+/).filter(Boolean).map((t) => t.replace(/^#/, ""))
    );
    body = body.replace(tagMatch[0], "");
  }

  // Extract inline hashtags
  const inlineTags = body.match(/#[a-zA-Z]\w+/g);
  if (inlineTags) {
    for (const tag of inlineTags) {
      const clean = tag.replace(/^#/, "");
      if (!hashtags.includes(clean)) hashtags.push(clean);
    }
  }

  // Clean up markdown formatting for social
  body = body
    .replace(/^#+\s+/gm, "")     // Remove heading markers
    .replace(/\*\*(.+?)\*\*/g, "$1") // Bold → plain
    .replace(/\*(.+?)\*/g, "$1")     // Italic → plain
    .replace(/!\[.*?\]\(.*?\)/g, "") // Remove image markdown
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)") // Links → text (url)
    .replace(/\n{3,}/g, "\n\n")   // Collapse whitespace
    .trim();

  return {
    text: body,
    hashtags: hashtags.length > 0 ? hashtags : undefined,
  };
}

program.parse(process.argv);
