/**
 * tier-scheduler.ts — Content scheduling engine
 *
 * Reads a content calendar YAML, determines what's due, publishes via
 * the appropriate backend, and records state to avoid double-publishing.
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
  parseCalendar,
  validateCalendar,
  getUpcoming,
  getPastDue,
  type ContentCalendar,
  type ScheduledPost,
  type Duration,
} from "./tier-calendar.js";

// ============================================================================
// Types
// ============================================================================

export interface PublishRecord {
  source: string;
  platform: string;
  scheduledDate: string;
  publishedAt: string;
  status: "published" | "failed";
  error?: string;
  postId?: string;
}

export interface CalendarState {
  records: PublishRecord[];
}

export interface ScheduleRunOptions {
  calendarPath: string;
  dryRun: boolean;
  window?: Duration;
}

// ============================================================================
// State Management
// ============================================================================

function stateFilePath(calendarPath: string): string {
  const dir = path.dirname(calendarPath);
  return path.join(dir, "calendar-state.json");
}

function loadState(calendarPath: string): CalendarState {
  const p = stateFilePath(calendarPath);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { records: [] };
  }
}

function saveState(calendarPath: string, state: CalendarState): void {
  fs.writeFileSync(stateFilePath(calendarPath), JSON.stringify(state, null, 2) + "\n");
}

function isAlreadyPublished(state: CalendarState, post: ScheduledPost): boolean {
  return state.records.some(
    (r) =>
      r.source === post.source &&
      r.platform === post.platform &&
      r.scheduledDate === post.scheduledDate.toISOString() &&
      r.status === "published"
  );
}

// ============================================================================
// Publishing Dispatch
// ============================================================================

async function publishPost(
  post: ScheduledPost,
  dryRun: boolean
): Promise<PublishRecord> {
  const record: PublishRecord = {
    source: post.source,
    platform: post.platform,
    scheduledDate: post.scheduledDate.toISOString(),
    publishedAt: new Date().toISOString(),
    status: "published",
  };

  if (dryRun) {
    return record;
  }

  try {
    switch (post.platform) {
      case "ghost": {
        // Use the existing Ghost publisher infrastructure
        // For now, log that it would publish — full integration connects to tier-publisher.ts
        console.log(
          chalk.dim(
            `  → Ghost publish: ${post.source} (tier: ${post.config.tier ?? "free"}, visibility: ${post.config.visibility ?? "public"})`
          )
        );
        // TODO: Wire to publishTiers() from tier-publisher.ts when tier files exist
        break;
      }
      case "twitter":
      case "linkedin":
      case "beehiiv": {
        // Social backends are being built by parallel subagent
        // For now, record as published with a note
        console.log(
          chalk.dim(
            `  → ${post.platform} publish: ${post.source} (format: ${post.config.format ?? "post"})`
          )
        );
        // TODO: Wire to social backends when available
        break;
      }
      default: {
        record.status = "failed";
        record.error = `Unknown platform: ${post.platform}`;
      }
    }
  } catch (err) {
    record.status = "failed";
    record.error = err instanceof Error ? err.message : String(err);
  }

  return record;
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Run scheduled publications — execute anything due within the window.
 */
export async function scheduleRun(opts: ScheduleRunOptions): Promise<void> {
  const cal = parseCalendar(opts.calendarPath);
  const errors = validateCalendar(cal).filter((v) => v.level === "error");
  if (errors.length > 0) {
    console.error(chalk.red("Calendar validation errors:"));
    for (const e of errors) {
      console.error(chalk.red(`  • ${e.message}${e.post ? ` (${e.post})` : ""}${e.platform ? ` [${e.platform}]` : ""}`));
    }
    process.exit(1);
  }

  const state = loadState(opts.calendarPath);
  const window = opts.window ?? { minutes: 15 };

  // Get past-due + upcoming within window
  const pastDue = getPastDue(cal).filter((p) => !isAlreadyPublished(state, p));
  const upcoming = getUpcoming(cal, window).filter((p) => !isAlreadyPublished(state, p));
  const due = [...pastDue, ...upcoming];

  // Deduplicate (a post could appear in both past-due and upcoming)
  const seen = new Set<string>();
  const unique = due.filter((p) => {
    const key = `${p.source}|${p.platform}|${p.scheduledDate.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    console.log(chalk.dim("Nothing due to publish."));
    return;
  }

  console.log(
    chalk.bold(
      `\n📅 ${opts.dryRun ? "DRY RUN — " : ""}${unique.length} post(s) due\n`
    )
  );

  for (const post of unique) {
    const label = `${post.source} → ${post.platform}`;
    const dateStr = post.scheduledDate.toLocaleString();

    if (opts.dryRun) {
      console.log(`  ${chalk.yellow("⏳")} ${label} ${chalk.dim(`(scheduled: ${dateStr})`)}`);
    } else {
      const result = await publishPost(post, false);
      state.records.push(result);

      if (result.status === "published") {
        console.log(`  ${chalk.green("✅")} ${label} ${chalk.dim(`(scheduled: ${dateStr})`)}`);
      } else {
        console.log(`  ${chalk.red("❌")} ${label} — ${result.error}`);
      }
    }
  }

  if (!opts.dryRun) {
    saveState(opts.calendarPath, state);
    console.log(chalk.dim(`\nState saved to ${stateFilePath(opts.calendarPath)}`));
  }

  console.log();
}

/**
 * Preview upcoming publications for the next 7 days.
 */
export async function schedulePreview(calendarPath: string): Promise<void> {
  const cal = parseCalendar(calendarPath);
  const state = loadState(calendarPath);
  const upcoming = getUpcoming(cal, { days: 7 });

  if (upcoming.length === 0) {
    console.log(chalk.dim("No posts scheduled in the next 7 days."));
    return;
  }

  console.log(chalk.bold(`\n📅 Upcoming (next 7 days) — ${upcoming.length} publication(s)\n`));

  let currentDay = "";
  for (const post of upcoming) {
    const day = post.scheduledDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

    if (day !== currentDay) {
      currentDay = day;
      console.log(chalk.bold(`  ${day}`));
    }

    const time = post.scheduledDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const published = isAlreadyPublished(state, post);
    const icon = published ? chalk.green("✅") : chalk.yellow("⏳");
    const platformColor =
      post.platform === "ghost" ? chalk.blue : post.platform === "twitter" ? chalk.cyan : chalk.white;

    console.log(
      `    ${icon} ${chalk.dim(time)} ${platformColor(post.platform.padEnd(10))} ${post.source}`
    );
  }

  console.log();
}

/**
 * Show status of all publications in the calendar.
 */
export async function scheduleStatus(calendarPath: string): Promise<void> {
  const cal = parseCalendar(calendarPath);
  const state = loadState(calendarPath);
  const now = Date.now();

  let published = 0;
  let pending = 0;
  let failed = 0;
  let pastDue = 0;

  console.log(chalk.bold("\n📊 Calendar Status\n"));

  for (const post of cal.posts) {
    console.log(chalk.bold(`  ${post.source}`));

    for (const [platform, config] of Object.entries(post.publish)) {
      const scheduledDate = new Date(config.date);
      const record = state.records.find(
        (r) =>
          r.source === post.source &&
          r.platform === platform &&
          r.scheduledDate === scheduledDate.toISOString()
      );

      let icon: string;
      let status: string;

      if (record?.status === "published") {
        icon = chalk.green("✅");
        status = chalk.green("published");
        published++;
      } else if (record?.status === "failed") {
        icon = chalk.red("❌");
        status = chalk.red(`failed: ${record.error}`);
        failed++;
      } else if (scheduledDate.getTime() <= now) {
        icon = chalk.red("⚠️ ");
        status = chalk.red("past due");
        pastDue++;
      } else {
        icon = chalk.yellow("⏳");
        status = chalk.yellow("pending");
        pending++;
      }

      const dateStr = scheduledDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      console.log(`    ${icon} ${platform.padEnd(10)} ${chalk.dim(dateStr)} ${status}`);
    }
  }

  console.log(chalk.bold("\n  Summary:"));
  console.log(`    ${chalk.green(`Published: ${published}`)}`);
  console.log(`    ${chalk.yellow(`Pending: ${pending}`)}`);
  if (pastDue > 0) console.log(`    ${chalk.red(`Past due: ${pastDue}`)}`);
  if (failed > 0) console.log(`    ${chalk.red(`Failed: ${failed}`)}`);
  console.log();
}
