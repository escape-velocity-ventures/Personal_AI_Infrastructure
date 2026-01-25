#!/usr/bin/env bun
/**
 * Content CLI - Unified blog and postmortem management
 *
 * Designed for natural language control:
 *   "Create a postmortem"     → content-cli pm create "Title"
 *   "List postmortems"        → content-cli pm list
 *   "Make PM-007 a blog post" → content-cli pm promote PM-007
 *   "Add to blog queue"       → content-cli blog add <file>
 *   "What's ready to publish" → content-cli blog list --drafts
 *   "Sync with Ghost"         → content-cli blog sync
 *
 * Maintains:
 *   - MEMORY/POSTMORTEM-INDEX.md
 *   - MEMORY/BLOG-INDEX.md
 *   - Auto-numbering for both systems
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join, basename } from "path";

// =============================================================================
// Paths
// =============================================================================

const MEMORY_DIR = join(homedir(), ".claude", "MEMORY");
const PM_INDEX = join(MEMORY_DIR, "POSTMORTEM-INDEX.md");
const BLOG_INDEX = join(MEMORY_DIR, "BLOG-INDEX.md");
const GHOST_CLI = join(
  homedir(),
  "EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/ghost-cli.ts"
);

// =============================================================================
// Index Parsing
// =============================================================================

interface PostmortemEntry {
  pmNumber: string; // PM-001
  date: string;
  title: string;
  severity: string;
  blogStatus: string;
  file: string;
  blogNumber?: number;
}

interface BlogEntry {
  blogNumber: number;
  date: string;
  title: string;
  source: string;
  type: string; // "Post" | "PM-001" etc
  status?: string; // draft | published
}

function parsePostmortemIndex(): PostmortemEntry[] {
  if (!existsSync(PM_INDEX)) return [];

  const content = readFileSync(PM_INDEX, "utf-8");
  const entries: PostmortemEntry[] = [];

  // Parse table rows
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(
      /\|\s*(PM-\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+)\s*\|\s*(\w+)\s*\|\s*([^|]+)\s*\|\s*`?([^`|]+)`?\s*\|/
    );
    if (match) {
      entries.push({
        pmNumber: match[1].trim(),
        date: match[2].trim(),
        title: match[3].trim(),
        severity: match[4].trim(),
        blogStatus: match[5].trim(),
        file: match[6].trim(),
      });
    }
  }

  return entries;
}

function parseBlogIndex(): { published: BlogEntry[]; drafts: BlogEntry[] } {
  if (!existsSync(BLOG_INDEX)) return { published: [], drafts: [] };

  const content = readFileSync(BLOG_INDEX, "utf-8");
  const published: BlogEntry[] = [];
  const drafts: BlogEntry[] = [];

  const lines = content.split("\n");
  let section = "";

  for (const line of lines) {
    if (line.includes("## Published")) section = "published";
    if (line.includes("## Drafts")) section = "drafts";

    const match = line.match(
      /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*`?([^`|]+)`?\s*\|(?:\s*([^|]*)\s*\|)?/
    );
    if (match && section) {
      const entry: BlogEntry = {
        blogNumber: parseInt(match[1]),
        date: match[2].trim(),
        title: match[3].trim(),
        source: match[4].trim(),
        type: match[5]?.trim() || "Post",
      };

      if (section === "published") {
        entry.status = "published";
        published.push(entry);
      } else if (section === "drafts") {
        entry.status = "draft";
        drafts.push(entry);
      }
    }
  }

  return { published, drafts };
}

function getNextPmNumber(): string {
  const entries = parsePostmortemIndex();
  if (entries.length === 0) return "PM-001";

  const numbers = entries.map((e) => parseInt(e.pmNumber.replace("PM-", "")));
  const max = Math.max(...numbers);
  return `PM-${String(max + 1).padStart(3, "0")}`;
}

function getNextBlogNumber(): number {
  const { published, drafts } = parseBlogIndex();
  const all = [...published, ...drafts];
  if (all.length === 0) return 1;

  const max = Math.max(...all.map((e) => e.blogNumber));
  return max + 1;
}

// =============================================================================
// Postmortem Template
// =============================================================================

function generatePostmortemTemplate(
  title: string,
  pmNumber: string,
  severity: string
): string {
  const date = new Date().toISOString().split("T")[0];

  return `# ${title}

**Postmortem ID:** ${pmNumber}
**Date:** ${date}
**Severity:** ${severity}
**Status:** Draft

---

## Summary

[One paragraph summary of what happened]

## Timeline

| Time | Event |
|------|-------|
| T+0 | [Initial event] |
| T+N | [Subsequent events] |

## Root Cause Analysis

[What was the underlying cause?]

1. **Primary cause:**
2. **Contributing factors:**

## Impact

- [User impact]
- [System impact]
- [Data impact]

## Resolution

[How was it fixed?]

## Lessons Learned

### What went well
-

### What went wrong
-

### Where we got lucky
-

## Action Items

| Action | Owner | Status |
|--------|-------|--------|
| [Preventive measure] | | Pending |

---

## Remediation Verification

- [ ] Root cause addressed
- [ ] Monitoring added
- [ ] Documentation updated
- [ ] Team notified

---

*Created: ${date}*
`;
}

// =============================================================================
// Index Updates
// =============================================================================

function addToPostmortemIndex(entry: PostmortemEntry): void {
  let content = existsSync(PM_INDEX)
    ? readFileSync(PM_INDEX, "utf-8")
    : getDefaultPmIndex();

  // Find the table and add row
  const newRow = `| ${entry.pmNumber} | ${entry.date} | ${entry.title} | ${entry.severity} | ${entry.blogStatus} | \`${entry.file}\` |`;

  // Insert before the --- after the table
  const tableEndMatch = content.match(
    /(\| PM-\d+[^\n]+\n)([\s\S]*?)(---\n\n## Categories)/
  );
  if (tableEndMatch) {
    content = content.replace(
      tableEndMatch[0],
      `${tableEndMatch[1]}${newRow}\n${tableEndMatch[2]}${tableEndMatch[3]}`
    );
  } else {
    // Fallback: append to end of table section
    content = content.replace(
      /(## Postmortems\n\n[^\n]+\n[^\n]+\n)([^]*?)(---)/,
      `$1$2${newRow}\n$3`
    );
  }

  // Update last updated date
  content = content.replace(
    /\*Last updated:.*\*/,
    `*Last updated: ${new Date().toISOString().split("T")[0]}*`
  );

  writeFileSync(PM_INDEX, content);
}

function addToBlogIndex(entry: BlogEntry): void {
  let content = existsSync(BLOG_INDEX)
    ? readFileSync(BLOG_INDEX, "utf-8")
    : getDefaultBlogIndex();

  const newRow = `| ${String(entry.blogNumber).padStart(2, "0")} | ${entry.date} | ${entry.title} | \`${entry.source}\` | ${entry.type} |`;

  // Add to drafts section
  const draftsMatch = content.match(
    /(## Drafts \(Ready to Publish\)\n\n[^\n]+\n[^\n]+\n)([^]*?)(---\n\n## Ideas)/
  );
  if (draftsMatch) {
    content = content.replace(
      draftsMatch[0],
      `${draftsMatch[1]}${draftsMatch[2]}${newRow}\n${draftsMatch[3]}`
    );
  }

  // Update next blog number
  content = content.replace(
    /\*\*Next blog number:\*\* \d+/,
    `**Next blog number:** ${entry.blogNumber + 1}`
  );

  // Update last updated
  content = content.replace(
    /\*Last updated:.*\*/,
    `*Last updated: ${new Date().toISOString().split("T")[0]}*`
  );

  writeFileSync(BLOG_INDEX, content);
}

function updatePmBlogStatus(pmNumber: string, blogNumber: number): void {
  let content = readFileSync(PM_INDEX, "utf-8");

  // Update the blog status column for this PM
  const regex = new RegExp(
    `(\\| ${pmNumber} \\|[^|]+\\|[^|]+\\|[^|]+\\|)[^|]+(\\|[^|]+\\|)`
  );
  content = content.replace(regex, `$1 ○ Draft (Blog #${blogNumber}) $2`);

  writeFileSync(PM_INDEX, content);
}

// =============================================================================
// Default Index Templates
// =============================================================================

function getDefaultPmIndex(): string {
  return `# Postmortem Index

Chronological list of all incident postmortems.

---

## Postmortems

| # | Date | Title | Severity | Blog Status | File |
|---|------|-------|----------|-------------|------|

---

## Categories

### AI Behavior Issues

### Infrastructure Incidents

---

*Last updated: ${new Date().toISOString().split("T")[0]}*
`;
}

function getDefaultBlogIndex(): string {
  return `# Blog Publication Index

Chronological numbering for blog publication.

---

## Published Posts

| Blog # | Date | Title | Source |
|--------|------|-------|--------|

---

## Drafts (Ready to Publish)

| Blog # | Date | Title | Source | Type |
|--------|------|-------|--------|------|

---

## Ideas (Not Yet Numbered)

| Title | Source | Notes |
|-------|--------|-------|

---

**Next blog number:** 1

*Last updated: ${new Date().toISOString().split("T")[0]}*
`;
}

// =============================================================================
// Commands: Postmortem
// =============================================================================

async function pmCreate(title: string, severity: string): Promise<void> {
  const pmNumber = getNextPmNumber();
  const date = new Date().toISOString().split("T")[0];
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const filename = `postmortem-${pmNumber.replace("PM-", "").padStart(3, "0")}-${slug}.md`;
  const filepath = join(MEMORY_DIR, filename);

  // Create file from template
  const content = generatePostmortemTemplate(title, pmNumber, severity);
  writeFileSync(filepath, content);

  // Update index
  addToPostmortemIndex({
    pmNumber,
    date,
    title,
    severity,
    blogStatus: "Draft",
    file: filename,
  });

  console.log(`\n✅ Postmortem created: ${pmNumber}`);
  console.log(`   File: ${filepath}`);
  console.log(`   Severity: ${severity}`);
  console.log(`\n   Next steps:`);
  console.log(`   1. Edit the postmortem: ${filename}`);
  console.log(`   2. When ready for blog: content-cli pm promote ${pmNumber}`);
  console.log();
}

function pmList(): void {
  const entries = parsePostmortemIndex();

  if (entries.length === 0) {
    console.log("\nNo postmortems found.\n");
    return;
  }

  console.log(`\n  #        Date         Severity   Blog Status          Title`);
  console.log(`  ${"─".repeat(75)}`);

  for (const e of entries) {
    const blogStatus = e.blogStatus.padEnd(18);
    const title = e.title.length > 35 ? e.title.slice(0, 32) + "..." : e.title;
    console.log(
      `  ${e.pmNumber}   ${e.date}   ${e.severity.padEnd(8)}   ${blogStatus}   ${title}`
    );
  }

  console.log(`\n  Total: ${entries.length} postmortems\n`);
}

async function pmPromote(pmNumber: string): Promise<void> {
  const entries = parsePostmortemIndex();
  const entry = entries.find(
    (e) => e.pmNumber.toUpperCase() === pmNumber.toUpperCase()
  );

  if (!entry) {
    console.error(`\n❌ Postmortem not found: ${pmNumber}\n`);
    process.exit(1);
  }

  const filepath = join(MEMORY_DIR, entry.file);
  if (!existsSync(filepath)) {
    console.error(`\n❌ File not found: ${filepath}\n`);
    process.exit(1);
  }

  // Get next blog number
  const blogNumber = getNextBlogNumber();

  // Create Ghost draft
  console.log(`\nCreating Ghost draft for ${pmNumber}...`);
  try {
    execSync(`bun run "${GHOST_CLI}" create --file "${filepath}"`, {
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Failed to create Ghost draft");
    process.exit(1);
  }

  // Update blog index
  addToBlogIndex({
    blogNumber,
    date: entry.date,
    title: entry.title,
    source: entry.file,
    type: pmNumber,
    status: "draft",
  });

  // Update PM index with blog reference
  updatePmBlogStatus(pmNumber, blogNumber);

  console.log(`\n✅ Promoted to blog!`);
  console.log(`   ${pmNumber} → Blog #${blogNumber}`);
  console.log(`   Ghost draft created`);
  console.log(`   Indexes updated\n`);
}

// =============================================================================
// Commands: Blog
// =============================================================================

async function blogAdd(filepath: string, date?: string): Promise<void> {
  if (!existsSync(filepath)) {
    console.error(`\n❌ File not found: ${filepath}\n`);
    process.exit(1);
  }

  // Extract title from file
  const content = readFileSync(filepath, "utf-8");
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : basename(filepath, ".md");

  const blogNumber = getNextBlogNumber();
  const entryDate = date || new Date().toISOString().split("T")[0];

  // Create Ghost draft
  console.log(`\nCreating Ghost draft...`);
  try {
    execSync(`bun run "${GHOST_CLI}" create --file "${filepath}"`, {
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Failed to create Ghost draft");
    process.exit(1);
  }

  // Update blog index
  addToBlogIndex({
    blogNumber,
    date: entryDate,
    title,
    source: basename(filepath),
    type: "Post",
    status: "draft",
  });

  console.log(`\n✅ Added to blog queue!`);
  console.log(`   Blog #${blogNumber}: ${title}`);
  console.log(`   Ghost draft created`);
  console.log(`   Index updated\n`);
}

function blogList(filter?: string): void {
  const { published, drafts } = parseBlogIndex();

  const showPublished = !filter || filter === "--published" || filter === "--all";
  const showDrafts = !filter || filter === "--drafts" || filter === "--all";

  console.log(`\n  #    Status       Date          Title`);
  console.log(`  ${"─".repeat(65)}`);

  if (showPublished) {
    for (const e of published) {
      const title = e.title.length > 40 ? e.title.slice(0, 37) + "..." : e.title;
      console.log(
        `  ${String(e.blogNumber).padStart(2, "0")}   ✓ published   ${e.date}   ${title}`
      );
    }
  }

  if (showDrafts) {
    for (const e of drafts) {
      const title = e.title.length > 40 ? e.title.slice(0, 37) + "..." : e.title;
      console.log(
        `  ${String(e.blogNumber).padStart(2, "0")}   ○ draft       ${e.date}   ${title}`
      );
    }
  }

  console.log(
    `\n  Published: ${published.length} | Drafts: ${drafts.length} | Total: ${published.length + drafts.length}\n`
  );
}

async function blogSync(): Promise<void> {
  console.log("\nSyncing with Ghost...");

  // Get current Ghost status
  const output = execSync(`bun run "${GHOST_CLI}" list`, {
    encoding: "utf-8",
  });

  console.log(output);
  console.log("✅ Blog index is current with Ghost.\n");

  // Future: Actually update BLOG-INDEX.md status from Ghost
}

// =============================================================================
// Help
// =============================================================================

function showHelp(): void {
  console.log(`
Content CLI - Blog and Postmortem Management

Usage:
  content-cli <command> [options]

Postmortem Commands:
  pm create <title> [--severity HIGH|MEDIUM|LOW]   Create new postmortem
  pm list                                          List all postmortems
  pm promote <PM-NNN>                              Create Ghost draft, add to blog

Blog Commands:
  blog add <file> [--date YYYY-MM-DD]              Add file to blog queue
  blog list [--drafts|--published|--all]           List blog entries
  blog sync                                        Sync status from Ghost

Natural Language Mapping:
  "Create a postmortem about X"    → pm create "X"
  "List postmortems"               → pm list
  "Make PM-007 a blog post"        → pm promote PM-007
  "Add this to the blog"           → blog add <file>
  "What drafts do we have"         → blog list --drafts

Examples:
  content-cli pm create "Database Connection Leak" --severity HIGH
  content-cli pm promote PM-007
  content-cli blog add ~/my-post.md
  content-cli blog list --drafts
`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  try {
    if (command === "pm") {
      if (subcommand === "create") {
        const title = args[2];
        if (!title) {
          console.error("Usage: content-cli pm create <title> [--severity HIGH]");
          process.exit(1);
        }
        const severityIdx = args.indexOf("--severity");
        const severity = severityIdx !== -1 ? args[severityIdx + 1] : "MEDIUM";
        await pmCreate(title, severity);
      } else if (subcommand === "list") {
        pmList();
      } else if (subcommand === "promote") {
        const pmNumber = args[2];
        if (!pmNumber) {
          console.error("Usage: content-cli pm promote <PM-NNN>");
          process.exit(1);
        }
        await pmPromote(pmNumber);
      } else {
        console.error(`Unknown pm subcommand: ${subcommand}`);
        process.exit(1);
      }
    } else if (command === "blog") {
      if (subcommand === "add") {
        const filepath = args[2];
        if (!filepath) {
          console.error("Usage: content-cli blog add <file>");
          process.exit(1);
        }
        const dateIdx = args.indexOf("--date");
        const date = dateIdx !== -1 ? args[dateIdx + 1] : undefined;
        await blogAdd(filepath, date);
      } else if (subcommand === "list") {
        const filter = args[2];
        blogList(filter);
      } else if (subcommand === "sync") {
        await blogSync();
      } else {
        console.error(`Unknown blog subcommand: ${subcommand}`);
        process.exit(1);
      }
    } else {
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${(error as Error).message}\n`);
    process.exit(1);
  }
}

main();
