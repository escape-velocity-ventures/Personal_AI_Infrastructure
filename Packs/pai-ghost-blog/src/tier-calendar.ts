/**
 * tier-calendar.ts — Declarative content calendar parser
 *
 * Reads YAML calendar manifests that define when/where content should be published.
 */

import fs from "fs";
import yaml from "js-yaml";

// ============================================================================
// Types
// ============================================================================

export interface PlatformConfig {
  date: string;
  tier?: string;
  visibility?: string;
  format?: string;
  [key: string]: unknown;
}

export interface CalendarPost {
  source: string;
  tiers: string[];
  publish: Record<string, PlatformConfig>;
}

export interface ContentCalendar {
  week: string;
  posts: CalendarPost[];
}

export interface ValidationResult {
  level: "error" | "warning";
  message: string;
  post?: string;
  platform?: string;
}

export interface ScheduledPost {
  source: string;
  platform: string;
  config: PlatformConfig;
  scheduledDate: Date;
}

export interface Duration {
  minutes?: number;
  hours?: number;
  days?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function durationToMs(d: Duration): number {
  return ((d.minutes ?? 0) * 60 + (d.hours ?? 0) * 3600 + (d.days ?? 0) * 86400) * 1000;
}

function flattenPosts(cal: ContentCalendar): ScheduledPost[] {
  const result: ScheduledPost[] = [];
  for (const post of cal.posts) {
    for (const [platform, config] of Object.entries(post.publish)) {
      result.push({
        source: post.source,
        platform,
        config,
        scheduledDate: new Date(config.date),
      });
    }
  }
  return result;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a YAML content calendar file.
 */
export function parseCalendar(filePath: string): ContentCalendar {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as ContentCalendar;
  if (!parsed || !parsed.posts) {
    throw new Error(`Invalid calendar file: missing 'posts' field`);
  }
  return parsed;
}

/**
 * Validate a parsed calendar for common issues.
 */
export function validateCalendar(cal: ContentCalendar): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (!cal.week) {
    results.push({ level: "warning", message: "Missing 'week' field" });
  }

  if (!cal.posts || cal.posts.length === 0) {
    results.push({ level: "error", message: "Calendar has no posts" });
    return results;
  }

  for (const post of cal.posts) {
    if (!post.source) {
      results.push({ level: "error", message: "Post missing 'source' field" });
      continue;
    }

    if (!post.publish || Object.keys(post.publish).length === 0) {
      results.push({
        level: "error",
        message: `Post has no publish targets`,
        post: post.source,
      });
      continue;
    }

    for (const [platform, config] of Object.entries(post.publish)) {
      if (!config.date) {
        results.push({
          level: "error",
          message: `Missing date`,
          post: post.source,
          platform,
        });
      } else {
        const d = new Date(config.date);
        if (isNaN(d.getTime())) {
          results.push({
            level: "error",
            message: `Invalid date: ${config.date}`,
            post: post.source,
            platform,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Get posts scheduled within a time window from now.
 */
export function getUpcoming(
  cal: ContentCalendar,
  within: Duration = { days: 7 }
): ScheduledPost[] {
  const now = Date.now();
  const windowMs = durationToMs(within);
  const cutoff = now + windowMs;

  return flattenPosts(cal)
    .filter((p) => {
      const t = p.scheduledDate.getTime();
      return t > now && t <= cutoff;
    })
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
}

/**
 * Get posts that are past their scheduled date but haven't been published.
 * (State tracking is handled by tier-scheduler.ts — this just returns all past-due by date.)
 */
export function getPastDue(cal: ContentCalendar): ScheduledPost[] {
  const now = Date.now();
  return flattenPosts(cal)
    .filter((p) => p.scheduledDate.getTime() <= now)
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
}
