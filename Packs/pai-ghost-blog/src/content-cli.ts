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
 *   - MEMORY/WORK/postmortems/POSTMORTEM-INDEX.md
 *   - MEMORY/WORK/blog/BLOG-INDEX.md
 *   - Auto-numbering for both systems
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join, basename } from "path";

// =============================================================================
// Paths
// =============================================================================

const MEMORY_DIR = join(homedir(), ".claude", "MEMORY");
const WORK_DIR = join(MEMORY_DIR, "WORK");
const PM_INDEX = join(WORK_DIR, "postmortems", "POSTMORTEM-INDEX.md");
const BLOG_INDEX = join(WORK_DIR, "blog", "BLOG-INDEX.md");
const GHOST_CLI = join(
  homedir(),
  "EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/ghost-cli.ts"
);

const STATE_SERVICE_URL = process.env.PAI_STATE_SERVICE_URL || "https://pai-state.escape-velocity-ventures.org";

// =============================================================================
// Cloud Sync - Prevents PM numbering collisions
// =============================================================================

async function getApiKey(): Promise<string | null> {
  if (process.env.PAI_STATE_API_KEY) return process.env.PAI_STATE_API_KEY;

  // Try kubectl
  try {
    const result = execSync(
      'kubectl get secret pai-state-api-key -n pai -o jsonpath="{.data.api-key}" 2>/dev/null',
      { encoding: "utf-8" }
    );
    if (result) {
      return Buffer.from(result, "base64").toString("utf-8");
    }
  } catch {
    // kubectl not available or secret not found
  }
  return null;
}

/**
 * Sync PM index from cloud BEFORE operating on it.
 * This prevents numbering collisions when cloud has newer data.
 */
async function syncPmIndexFromCloud(): Promise<boolean> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("⚠️  Warning: Cannot sync from cloud (no API key). Using local index only.");
    return false;
  }

  try {
    const response = await fetch(`${STATE_SERVICE_URL}/memory/WORK/postmortems/POSTMORTEM-INDEX.md`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Cloud index doesn't exist yet - that's OK
        return true;
      }
      console.error(`⚠️  Warning: Cloud sync failed (${response.status}). Using local index.`);
      return false;
    }

    const data = await response.json();
    if (!data.content) {
      return true; // Empty content is fine
    }

    // Ensure directory exists
    const pmDir = join(WORK_DIR, "postmortems");
    mkdirSync(pmDir, { recursive: true });

    // Write cloud content to local
    writeFileSync(PM_INDEX, data.content, "utf-8");
    return true;
  } catch (err) {
    console.error(`⚠️  Warning: Cloud sync error: ${err}. Using local index.`);
    return false;
  }
}

/**
 * Sync PM index TO cloud after creating/updating.
 */
async function syncPmIndexToCloud(): Promise<boolean> {
  const apiKey = await getApiKey();
  if (!apiKey || !existsSync(PM_INDEX)) return false;

  try {
    const content = readFileSync(PM_INDEX, "utf-8");
    const response = await fetch(`${STATE_SERVICE_URL}/memory/WORK/postmortems/POSTMORTEM-INDEX.md`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, mtime: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sync a specific PM file to cloud.
 */
async function syncPmFileToCloud(filepath: string, relativePath: string): Promise<boolean> {
  const apiKey = await getApiKey();
  if (!apiKey || !existsSync(filepath)) return false;

  try {
    const content = readFileSync(filepath, "utf-8");
    const response = await fetch(`${STATE_SERVICE_URL}/memory/${relativePath}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, mtime: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

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

interface RatingResult {
  title: string;
  file: string;
  score: number; // 1-100
  breakdown?: {
    clarity: number; // /20
    depth: number; // /20
    storytelling: number; // /20
    actionable: number; // /20
    uniqueness: number; // /20
  };
  summary: string;
  recommendation?: string;
  publishReady: boolean;
  // rate_content specific fields
  labels?: string;
  tier?: string;
  pattern?: "rate_blog_post" | "rate_content";
}

type RatingPattern = "rate_blog_post" | "rate_content";

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
// Article Rating
// =============================================================================

async function rateArticle(
  filepath: string,
  pattern: RatingPattern = "rate_blog_post"
): Promise<RatingResult> {
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const content = readFileSync(filepath, "utf-8");
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : basename(filepath, ".md");

  try {
    const result = execSync(
      `cat "${filepath}" | fabric-ai --model claude-3-5-haiku-latest -p ${pattern}`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: "/bin/bash" }
    );

    if (pattern === "rate_blog_post") {
      // Parse JSON from response (handle markdown code blocks)
      let jsonStr = result;
      const codeBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      }
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const rating = JSON.parse(jsonMatch[0]);
      return {
        title,
        file: basename(filepath),
        pattern,
        ...rating,
      };
    } else {
      // Parse rate_content markdown output
      const labelsMatch = result.match(/LABELS:\s*\n\s*([^\n]+)/);
      const tierMatch = result.match(/(S|A|B|C|D) Tier[:\s]*\([^)]+\)/);
      const scoreMatch = result.match(/(?:CONTENT SCORE|QUALITY SCORE):\s*\n\s*(\d+)/);
      const explanationMatch = result.match(/Explanation:\s*([\s\S]*?)(?=\n\n|CONTENT SCORE|QUALITY SCORE|$)/);

      const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
      const tier = tierMatch ? tierMatch[0] : "Unknown";
      const labels = labelsMatch ? labelsMatch[1].trim() : "";
      const summary = explanationMatch ? explanationMatch[1].trim().replace(/^-\s*/gm, "").split("\n").slice(0, 2).join(" ") : "";

      return {
        title,
        file: basename(filepath),
        score,
        tier,
        labels,
        summary,
        publishReady: score >= 75,
        pattern,
      };
    }
  } catch (error) {
    throw new Error(
      `Rating failed: ${(error as Error).message}`
    );
  }
}

function formatRating(rating: RatingResult): string {
  const bar = (val: number) => "█".repeat(Math.floor(val / 2)) + "░".repeat(10 - Math.floor(val / 2));
  const statusIcon = rating.publishReady ? "✓" : "○";
  const statusText = rating.publishReady ? "Ready to publish" : "Needs work";

  if (rating.pattern === "rate_content") {
    // Format for rate_content (tier-based)
    return `
${rating.title}
${"─".repeat(60)}
File: ${rating.file}
Score: ${rating.score}/100 | ${rating.tier}

Labels: ${rating.labels}

Summary: ${rating.summary}
`;
  }

  // Format for rate_blog_post (breakdown-based)
  const { breakdown } = rating;
  if (!breakdown) {
    return `
${rating.title}
${"─".repeat(60)}
File: ${rating.file}
Score: ${rating.score}/100 ${statusIcon} ${statusText}

Summary: ${rating.summary}
`;
  }

  return `
${rating.title}
${"─".repeat(60)}
File: ${rating.file}
Score: ${rating.score}/100 ${statusIcon} ${statusText}

  Clarity:     ${bar(breakdown.clarity)} ${breakdown.clarity}/20
  Depth:       ${bar(breakdown.depth)} ${breakdown.depth}/20
  Storytelling:${bar(breakdown.storytelling)} ${breakdown.storytelling}/20
  Actionable:  ${bar(breakdown.actionable)} ${breakdown.actionable}/20
  Uniqueness:  ${bar(breakdown.uniqueness)} ${breakdown.uniqueness}/20

Summary: ${rating.summary}

Recommendation: ${rating.recommendation}
`;
}

function formatRatingSummary(ratings: RatingResult[]): string {
  if (ratings.length === 0) return "No articles to rate.";

  const sorted = [...ratings].sort((a, b) => b.score - a.score);
  const avg = Math.round(ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length);
  const ready = ratings.filter((r) => r.publishReady).length;
  const pattern = ratings[0]?.pattern || "rate_blog_post";

  let output = `
Draft Quality Summary (${pattern})
${"═".repeat(60)}
Total: ${ratings.length} drafts | Average: ${avg}/100 | Ready: ${ready}

Ranked by Quality:
${"─".repeat(60)}
`;

  for (const r of sorted) {
    const icon = r.publishReady ? "✓" : "○";
    const title = r.title.length > 35 ? r.title.slice(0, 32) + "..." : r.title;
    if (r.pattern === "rate_content" && r.tier) {
      const tierShort = r.tier.charAt(0); // S, A, B, C, D
      output += `  ${tierShort} ${String(r.score).padStart(3)}/100  ${title}\n`;
    } else {
      output += `  ${icon} ${String(r.score).padStart(3)}/100  ${title}\n`;
    }
  }

  output += `\n${"─".repeat(60)}\n`;

  // Top recommendations (only for rate_blog_post)
  if (pattern === "rate_blog_post") {
    const needsWork = sorted.filter((r) => !r.publishReady).slice(0, 3);
    if (needsWork.length > 0) {
      output += "\nTop Improvement Opportunities:\n";
      for (const r of needsWork) {
        output += `  • ${r.title.slice(0, 30)}...: ${r.recommendation}\n`;
      }
    }
  } else {
    // Show labels summary for rate_content
    const allLabels = ratings.flatMap((r) => r.labels?.split(", ") || []);
    const labelCounts = allLabels.reduce((acc, l) => {
      acc[l] = (acc[l] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topLabels = Object.entries(labelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([l]) => l);
    output += `\nTop Labels: ${topLabels.join(", ")}\n`;
  }

  return output;
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
  // CRITICAL: Sync from cloud FIRST to prevent numbering collisions
  console.log("🔄 Syncing PM index from cloud...");
  await syncPmIndexFromCloud();

  const pmNumber = getNextPmNumber();
  const date = new Date().toISOString().split("T")[0];
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const filename = `postmortem-${pmNumber.replace("PM-", "").padStart(3, "0")}-${slug}.md`;
  const pmDir = join(WORK_DIR, "postmortems");
  mkdirSync(pmDir, { recursive: true });
  const filepath = join(pmDir, filename);

  // Check for collision - file should not exist
  if (existsSync(filepath)) {
    console.error(`\n❌ Error: File already exists: ${filepath}`);
    console.error(`   This suggests a numbering collision. Check cloud state.`);
    process.exit(1);
  }

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

  // Sync back to cloud immediately
  console.log("☁️  Syncing to cloud...");
  const relativePath = `WORK/postmortems/${filename}`;
  const [indexSynced, fileSynced] = await Promise.all([
    syncPmIndexToCloud(),
    syncPmFileToCloud(filepath, relativePath),
  ]);

  console.log(`\n✅ Postmortem created: ${pmNumber}`);
  console.log(`   File: ${filepath}`);
  console.log(`   Severity: ${severity}`);
  console.log(`   Cloud sync: ${indexSynced && fileSynced ? "✓ Synced" : "⚠️ Partial (will sync at session end)"}`);
  console.log(`\n   Next steps:`);
  console.log(`   1. Edit the postmortem: ${filename}`);
  console.log(`   2. When ready for blog: content-cli pm promote ${pmNumber}`);
  console.log();
}

async function pmList(): Promise<void> {
  // Sync from cloud first to show latest state
  await syncPmIndexFromCloud();
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

async function blogRate(
  target: string,
  allDrafts: boolean,
  pattern: RatingPattern = "rate_blog_post"
): Promise<void> {
  const BLOG_DIR = join(MEMORY_DIR, "WORK", "blog");
  const PM_DIR = join(MEMORY_DIR, "WORK", "postmortems");

  console.log(`\nUsing pattern: ${pattern}\n`);

  if (allDrafts) {
    // Rate all draft articles
    const { drafts } = parseBlogIndex();

    if (drafts.length === 0) {
      console.log("No drafts to rate.\n");
      return;
    }

    console.log(`Rating ${drafts.length} drafts...\n`);
    const ratings: RatingResult[] = [];

    for (const draft of drafts) {
      // Find the source file
      let filepath = "";
      if (draft.source.includes("Ghost draft")) {
        console.log(`  ⚠ Skipping ${draft.title} (Ghost-only, no local file)`);
        continue;
      }

      // Check blog dir first, then postmortems
      const blogPath = join(BLOG_DIR, draft.source);
      const pmPath = join(PM_DIR, draft.source);

      if (existsSync(blogPath)) {
        filepath = blogPath;
      } else if (existsSync(pmPath)) {
        filepath = pmPath;
      } else {
        console.log(`  ⚠ Skipping ${draft.title} (file not found: ${draft.source})`);
        continue;
      }

      process.stdout.write(`  Rating: ${draft.title.slice(0, 40)}...`);
      try {
        const rating = await rateArticle(filepath, pattern);
        ratings.push(rating);
        if (pattern === "rate_content" && rating.tier) {
          console.log(` ${rating.score}/100 (${rating.tier.charAt(0)}-Tier)`);
        } else {
          console.log(` ${rating.score}/100`);
        }
      } catch (error) {
        console.log(` ❌ Error: ${(error as Error).message}`);
      }
    }

    console.log(formatRatingSummary(ratings));
  } else {
    // Rate single article
    let filepath = target;

    // Check if it's a relative path or needs resolution
    if (!existsSync(filepath)) {
      // Try blog dir
      const blogPath = join(BLOG_DIR, target);
      const pmPath = join(PM_DIR, target);

      if (existsSync(blogPath)) {
        filepath = blogPath;
      } else if (existsSync(pmPath)) {
        filepath = pmPath;
      } else if (existsSync(target + ".md")) {
        filepath = target + ".md";
      } else {
        console.error(`\n❌ File not found: ${target}`);
        console.error(`   Tried: ${target}, ${blogPath}, ${pmPath}\n`);
        process.exit(1);
      }
    }

    console.log(`Rating article...`);
    const rating = await rateArticle(filepath, pattern);
    console.log(formatRating(rating));
  }
}

async function blogStatus(): Promise<void> {
  const BLOG_DIR = join(MEMORY_DIR, "WORK", "blog");
  const PM_DIR = join(MEMORY_DIR, "WORK", "postmortems");
  const { published, drafts } = parseBlogIndex();

  console.log(`
Blog Status Dashboard
${"═".repeat(60)}
Published: ${published.length} | Drafts: ${drafts.length} | Total: ${published.length + drafts.length}
${"─".repeat(60)}
`);

  // Quick summary of drafts without rating (for fast status check)
  console.log("Draft Queue:");
  for (const draft of drafts) {
    let hasFile = false;
    const blogPath = join(BLOG_DIR, draft.source);
    const pmPath = join(PM_DIR, draft.source);

    if (draft.source.includes("Ghost draft")) {
      hasFile = false;
    } else if (existsSync(blogPath) || existsSync(pmPath)) {
      hasFile = true;
    }

    const fileIcon = hasFile ? "📄" : "☁️ ";
    const typeTag = draft.type.startsWith("PM-") ? `[${draft.type}]` : "";
    const title = draft.title.length > 45 ? draft.title.slice(0, 42) + "..." : draft.title;
    console.log(`  ${fileIcon} #${String(draft.blogNumber).padStart(2, "0")} ${title} ${typeTag}`);
  }

  console.log(`
${"─".repeat(60)}
📄 = Has local file  |  ☁️  = Ghost-only

To rate drafts: content-cli blog rate --all-drafts
To rate one:    content-cli blog rate <filename>
`);
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
  blog rate <file> [--pattern X]                   Rate a single article (1-100)
  blog rate --all-drafts [--pattern X]             Rate all draft articles
  blog status                                      Dashboard of drafts with file status

Rating Patterns (--pattern):
  rate_blog_post (default)  Editorial quality: clarity, depth, storytelling, actionable, uniqueness
  rate_content              Consumption priority: S/A/B/C/D tiers, labels, idea density

Natural Language Mapping:
  "Create a postmortem about X"    → pm create "X"
  "List postmortems"               → pm list
  "Make PM-007 a blog post"        → pm promote PM-007
  "Add this to the blog"           → blog add <file>
  "What drafts do we have"         → blog list --drafts
  "Rate my drafts"                 → blog rate --all-drafts
  "How good is this article?"      → blog rate <file>
  "Would I consume this?"          → blog rate <file> --pattern rate_content
  "Show blog status"               → blog status

Examples:
  content-cli pm create "Database Connection Leak" --severity HIGH
  content-cli pm promote PM-007
  content-cli blog add ~/my-post.md
  content-cli blog list --drafts
  content-cli blog rate blog-post-8-bulletproof-observability.md
  content-cli blog rate --all-drafts
  content-cli blog rate --all-drafts --pattern rate_content
  content-cli blog status
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
        await pmList();
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
      } else if (subcommand === "rate") {
        const target = args[2];
        const allDrafts = target === "--all-drafts" || args.includes("--all-drafts");
        if (!target && !allDrafts) {
          console.error("Usage: content-cli blog rate <file> OR content-cli blog rate --all-drafts [--pattern rate_blog_post|rate_content]");
          process.exit(1);
        }
        // Parse --pattern flag
        const patternIdx = args.indexOf("--pattern");
        let pattern: RatingPattern = "rate_blog_post";
        if (patternIdx !== -1 && args[patternIdx + 1]) {
          const p = args[patternIdx + 1];
          if (p === "rate_blog_post" || p === "rate_content") {
            pattern = p;
          } else {
            console.error(`Unknown pattern: ${p}. Use rate_blog_post or rate_content`);
            process.exit(1);
          }
        }
        await blogRate(allDrafts ? "" : target, allDrafts, pattern);
      } else if (subcommand === "status") {
        await blogStatus();
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
