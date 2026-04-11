/**
 * Content calendar YAML schema tests
 *
 * Validates parsing, validation, and edge cases for content-calendar.yaml entries
 * consumed by the scheduling engine.
 */

import { describe, it, expect } from "bun:test";
import {
  parseCalendarYaml,
  validateCalendarEntries,
  type CalendarEntry,
} from "../calendar-schema.js";

// ============================================================================
// Fixtures
// ============================================================================

const VALID_YAML = `
- content_file: posts/hello-world.md
  platforms:
    - twitter
    - linkedin
  scheduled_at: "2026-04-15T09:00:00Z"
  tags:
    - launch
    - announcement
  tier: free
  status: pending

- content_file: posts/premium-guide.md
  platforms:
    - twitter
  scheduled_at: "2026-04-16T14:30:00Z"
  tier: pro
  status: pending
`;

const MINIMAL_YAML = `
- content_file: posts/quick.md
  platforms:
    - twitter
  scheduled_at: "2026-04-15T09:00:00Z"
`;

const EMPTY_YAML = `[]`;

const INVALID_DATE_YAML = `
- content_file: posts/bad-date.md
  platforms:
    - twitter
  scheduled_at: "not-a-date"
`;

const MISSING_FIELDS_YAML = `
- platforms:
    - twitter
  scheduled_at: "2026-04-15T09:00:00Z"
`;

const NO_PLATFORMS_YAML = `
- content_file: posts/orphan.md
  platforms: []
  scheduled_at: "2026-04-15T09:00:00Z"
`;

const MULTI_STATUS_YAML = `
- content_file: posts/published.md
  platforms:
    - twitter
  scheduled_at: "2026-04-10T09:00:00Z"
  status: published

- content_file: posts/failed.md
  platforms:
    - linkedin
  scheduled_at: "2026-04-10T10:00:00Z"
  status: failed

- content_file: posts/waiting.md
  platforms:
    - twitter
    - linkedin
  scheduled_at: "2026-04-20T09:00:00Z"
  status: pending
`;

// ============================================================================
// parseCalendarYaml
// ============================================================================

describe("parseCalendarYaml", () => {
  it("parses valid YAML with all fields", () => {
    const entries = parseCalendarYaml(VALID_YAML);
    expect(entries).toHaveLength(2);

    const first = entries[0];
    expect(first.content_file).toBe("posts/hello-world.md");
    expect(first.platforms).toEqual(["twitter", "linkedin"]);
    expect(first.scheduled_at).toBe("2026-04-15T09:00:00Z");
    expect(first.tags).toEqual(["launch", "announcement"]);
    expect(first.tier).toBe("free");
    expect(first.status).toBe("pending");
  });

  it("parses minimal YAML with only required fields", () => {
    const entries = parseCalendarYaml(MINIMAL_YAML);
    expect(entries).toHaveLength(1);

    const entry = entries[0];
    expect(entry.content_file).toBe("posts/quick.md");
    expect(entry.platforms).toEqual(["twitter"]);
    expect(entry.scheduled_at).toBe("2026-04-15T09:00:00Z");
    // Optional fields should be undefined
    expect(entry.tags).toBeUndefined();
    expect(entry.tier).toBeUndefined();
    // Status defaults to 'pending' when not provided
    expect(entry.status).toBe("pending");
  });

  it("parses empty array", () => {
    const entries = parseCalendarYaml(EMPTY_YAML);
    expect(entries).toHaveLength(0);
  });

  it("throws on non-array YAML", () => {
    expect(() => parseCalendarYaml("key: value")).toThrow();
  });

  it("throws on completely invalid YAML", () => {
    expect(() => parseCalendarYaml("{{{{invalid")).toThrow();
  });

  it("preserves all status values", () => {
    const entries = parseCalendarYaml(MULTI_STATUS_YAML);
    expect(entries[0].status).toBe("published");
    expect(entries[1].status).toBe("failed");
    expect(entries[2].status).toBe("pending");
  });

  it("handles tier values correctly", () => {
    const yaml = `
- content_file: a.md
  platforms: [twitter]
  scheduled_at: "2026-04-15T09:00:00Z"
  tier: starter
`;
    const entries = parseCalendarYaml(yaml);
    expect(entries[0].tier).toBe("starter");
  });
});

// ============================================================================
// validateCalendarEntries
// ============================================================================

describe("validateCalendarEntries", () => {
  it("returns no errors for valid entries", () => {
    const entries = parseCalendarYaml(VALID_YAML);
    const errors = validateCalendarEntries(entries);
    expect(errors).toHaveLength(0);
  });

  it("returns no errors for minimal valid entry", () => {
    const entries = parseCalendarYaml(MINIMAL_YAML);
    const errors = validateCalendarEntries(entries);
    expect(errors).toHaveLength(0);
  });

  it("returns error for missing content_file", () => {
    const entries = parseCalendarYaml(MISSING_FIELDS_YAML);
    const errors = validateCalendarEntries(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("content_file"))).toBe(true);
  });

  it("returns error for invalid date", () => {
    const entries = parseCalendarYaml(INVALID_DATE_YAML);
    const errors = validateCalendarEntries(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("date") || e.includes("scheduled_at"))).toBe(true);
  });

  it("returns error for empty platforms array", () => {
    const entries = parseCalendarYaml(NO_PLATFORMS_YAML);
    const errors = validateCalendarEntries(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("platform"))).toBe(true);
  });

  it("returns error for invalid tier value", () => {
    const entries: CalendarEntry[] = [
      {
        content_file: "a.md",
        platforms: ["twitter"],
        scheduled_at: "2026-04-15T09:00:00Z",
        tier: "enterprise" as any,
        status: "pending",
      },
    ];
    const errors = validateCalendarEntries(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("tier"))).toBe(true);
  });

  it("returns error for invalid status value", () => {
    const entries: CalendarEntry[] = [
      {
        content_file: "a.md",
        platforms: ["twitter"],
        scheduled_at: "2026-04-15T09:00:00Z",
        status: "unknown" as any,
      },
    ];
    const errors = validateCalendarEntries(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("validates multiple entries and aggregates errors", () => {
    const entries: CalendarEntry[] = [
      {
        content_file: "",
        platforms: [],
        scheduled_at: "not-a-date",
        status: "pending",
      },
      {
        content_file: "ok.md",
        platforms: ["twitter"],
        scheduled_at: "2026-04-15T09:00:00Z",
        status: "pending",
      },
    ];
    const errors = validateCalendarEntries(entries);
    // First entry has 3 errors (empty content_file, empty platforms, bad date)
    // Second entry is valid
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("returns no errors for empty array", () => {
    const errors = validateCalendarEntries([]);
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// CalendarEntry type contract
// ============================================================================

describe("CalendarEntry type contract", () => {
  it("has required fields: content_file, platforms, scheduled_at", () => {
    const entry: CalendarEntry = {
      content_file: "test.md",
      platforms: ["twitter"],
      scheduled_at: "2026-04-15T09:00:00Z",
      status: "pending",
    };
    expect(entry.content_file).toBeDefined();
    expect(entry.platforms).toBeDefined();
    expect(entry.scheduled_at).toBeDefined();
  });

  it("supports optional fields: tags, tier", () => {
    const entry: CalendarEntry = {
      content_file: "test.md",
      platforms: ["twitter", "linkedin"],
      scheduled_at: "2026-04-15T09:00:00Z",
      tags: ["launch"],
      tier: "starter",
      status: "pending",
    };
    expect(entry.tags).toEqual(["launch"]);
    expect(entry.tier).toBe("starter");
  });
});
