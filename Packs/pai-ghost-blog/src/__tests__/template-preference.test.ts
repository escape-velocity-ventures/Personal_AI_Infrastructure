import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Proves the WIRING, not the filling: that generatePostmortemTemplate prefers
// the canonical TEMPLATE.md on disk over its inline fallback. PM_DIR is resolved
// at module load from POSTMORTEM_DIR, so the env must be set before the import —
// hence the dynamic import rather than a top-level one.
describe("generatePostmortemTemplate prefers the canonical template", () => {
  let out = "";

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmdir-"));
    // A canonical file with a section the inline fallback does not have, so
    // seeing it proves the file was read rather than the fallback used.
    writeFileSync(
      join(dir, "TEMPLATE.md"),
      [
        "# Postmortem: <Incident Title>",
        "",
        "- **PM number:** PM-NNN",
        "- **Date:** YYYY-MM-DD",
        "- **Status:** Draft",
        "- **Severity:** SEV1 | SEV2 | SEV3",
        "",
        "## Canary Section Only In The Canonical File",
        "<marker>",
        "",
      ].join("\n")
    );
    process.env.POSTMORTEM_DIR = dir;
    const mod = await import("../content-cli");
    out = mod.generatePostmortemTemplate("t", "PM-2026-10-06-01", "SEV2");
  });

  test("reads the file from PM_DIR", () => {
    expect(out).toContain("## Canary Section Only In The Canonical File");
  });

  test("and still substitutes into it", () => {
    expect(out).toContain("# Postmortem: t");
    expect(out).toContain("- **PM number:** PM-2026-10-06-01");
    expect(out).toContain("- **Severity:** SEV2");
  });

  test("does not fall back to the inline copy when the file is present", () => {
    expect(out).not.toContain("## Supporting Information");
  });
});
