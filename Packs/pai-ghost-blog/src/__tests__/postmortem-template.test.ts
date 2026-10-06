import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { fillCanonicalTemplate } from "../content-cli";

// A verbatim copy of TinkerBelle-config postmortems/TEMPLATE.md @ origin/main.
// If the canonical template changes shape, refresh this fixture — the point of
// the test is that we fill the CANONICAL file rather than a second copy of it
// (pai-config-51xc).
const CANONICAL = readFileSync(join(import.meta.dir, "TEMPLATE.fixture.md"), "utf-8");

const REQUIRED_SECTIONS = [
  "Summary", "Impact", "Root Causes", "Trigger", "Detection",
  "Resolution", "Action Items", "Lessons Learned", "Timeline",
  "Supporting Information",
];

describe("fillCanonicalTemplate", () => {
  const out = fillCanonicalTemplate(
    CANONICAL, "aristotle lost its CSI driver", "PM-2026-10-06-01", "SEV2", "2026-10-06"
  );

  test("keeps every canonical section", () => {
    for (const s of REQUIRED_SECTIONS) {
      expect(out).toContain(`## ${s}`);
    }
  });

  // The three the old inline copy silently dropped.
  test("emits Trigger, Detection and Supporting Information", () => {
    expect(out).toContain("## Trigger");
    expect(out).toContain("## Detection");
    expect(out).toContain("## Supporting Information");
  });

  test("substitutes the title, id, date and severity", () => {
    expect(out).toContain("# Postmortem: aristotle lost its CSI driver");
    expect(out).toMatch(/- \*\*PM (?:number|ID):\*\* PM-2026-10-06-01/);
    expect(out).toContain("- **Date:** 2026-10-06");
    expect(out).toContain("- **Status:** Draft");
    expect(out).toContain("- **Severity:** SEV2");
  });

  test("leaves Authors and Affected services for the filer", () => {
    expect(out).toContain("- **Authors:**");
    expect(out).toContain("- **Affected services:**");
  });

  test("drops the instructional quote block", () => {
    expect(out).not.toContain("Delete this quote block when filing");
    expect(out).not.toContain("not applied retroactively");
  });

  // The guard: only the FIRST quote run goes, and only if it is the
  // instructions. Action Items and Timeline carry quote blocks that must live.
  test("keeps the Action Items and Timeline quote blocks", () => {
    expect(out).toContain("> Every item gets an owner");
    expect(out).toContain("> All times with timezone");
  });

  test("preserves a renamed PM field label rather than forcing one", () => {
    const renamed = CANONICAL.replace("- **PM number:**", "- **PM ID:**");
    const o = fillCanonicalTemplate(renamed, "t", "PM-2026-10-06-01", "SEV3", "2026-10-06");
    expect(o).toContain("- **PM ID:** PM-2026-10-06-01");
    expect(o).not.toContain("PM-NNN");
  });

  test("ends with exactly one trailing newline", () => {
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
