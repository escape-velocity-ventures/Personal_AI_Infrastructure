/**
 * calendar-schema.ts — Content calendar YAML schema and parser
 *
 * TypeScript types and parsing for content-calendar.yaml entries.
 * Used by the scheduling engine (scheduler.ts) and tier-cli schedule commands.
 */

import yaml from "js-yaml";

// ============================================================================
// Types
// ============================================================================

/** Valid content tier levels */
export type ContentTier = "free" | "starter" | "pro";

/** Runtime publication status */
export type PublishStatus = "pending" | "published" | "failed";

/**
 * A single entry in the content calendar YAML.
 *
 * Example YAML:
 * ```yaml
 * - content_file: posts/hello-world.md
 *   platforms:
 *     - twitter
 *     - linkedin
 *   scheduled_at: "2026-04-15T09:00:00Z"
 *   tags:
 *     - launch
 *   tier: free
 *   status: pending
 * ```
 */
export interface CalendarEntry {
  /** Path to the markdown content file */
  content_file: string;
  /** Target social platforms */
  platforms: string[];
  /** ISO 8601 date string for scheduled publication */
  scheduled_at: string;
  /** Optional content tags for categorization */
  tags?: string[];
  /** Optional content tier for visibility gating */
  tier?: ContentTier;
  /** Runtime publication status (defaults to 'pending') */
  status: PublishStatus;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_TIERS: ReadonlySet<string> = new Set(["free", "starter", "pro"]);
const VALID_STATUSES: ReadonlySet<string> = new Set(["pending", "published", "failed"]);

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse YAML content into an array of CalendarEntry objects.
 *
 * Expects the YAML to be an array of objects. Missing optional fields
 * are left undefined; status defaults to 'pending' if not provided.
 *
 * @throws Error if YAML is invalid or not an array
 */
export function parseCalendarYaml(yamlContent: string): CalendarEntry[] {
  const parsed = yaml.load(yamlContent);

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Invalid calendar YAML: expected an array of entries"
    );
  }

  return parsed.map((raw: Record<string, unknown>) => {
    const entry: CalendarEntry = {
      content_file: raw.content_file as string,
      platforms: (raw.platforms as string[]) ?? [],
      scheduled_at: raw.scheduled_at as string,
      status: (raw.status as PublishStatus) ?? "pending",
    };

    if (raw.tags !== undefined) {
      entry.tags = raw.tags as string[];
    }

    if (raw.tier !== undefined) {
      entry.tier = raw.tier as ContentTier;
    }

    return entry;
  });
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate an array of CalendarEntry objects.
 *
 * Returns an array of human-readable error strings. Empty array means valid.
 */
export function validateCalendarEntries(entries: CalendarEntry[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prefix = `Entry ${i + 1}`;

    // Required: content_file
    if (!entry.content_file) {
      errors.push(`${prefix}: missing or empty content_file`);
    }

    // Required: platforms (non-empty array)
    if (!entry.platforms || entry.platforms.length === 0) {
      errors.push(`${prefix}: platforms must be a non-empty array`);
    }

    // Required: scheduled_at (valid ISO date)
    if (!entry.scheduled_at) {
      errors.push(`${prefix}: missing scheduled_at`);
    } else {
      const d = new Date(entry.scheduled_at);
      if (isNaN(d.getTime())) {
        errors.push(
          `${prefix}: invalid scheduled_at date "${entry.scheduled_at}"`
        );
      }
    }

    // Optional: tier (must be valid if present)
    if (entry.tier !== undefined && !VALID_TIERS.has(entry.tier)) {
      errors.push(
        `${prefix}: invalid tier "${entry.tier}" (must be free, starter, or pro)`
      );
    }

    // Optional: status (must be valid if present)
    if (entry.status !== undefined && !VALID_STATUSES.has(entry.status)) {
      errors.push(
        `${prefix}: invalid status "${entry.status}" (must be pending, published, or failed)`
      );
    }
  }

  return errors;
}
