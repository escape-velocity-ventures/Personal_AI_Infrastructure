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

// BLOG_CONTENT_DIR env var allows sharing blog content via separate repo
// Falls back to ~/.claude/MEMORY/WORK for backward compatibility
const CONTENT_DIR = process.env.BLOG_CONTENT_DIR
  || join(homedir(), ".claude", "MEMORY", "WORK");
const MEMORY_DIR = join(homedir(), ".claude", "MEMORY");
const WORK_DIR = join(MEMORY_DIR, "WORK");
const PM_INDEX = join(CONTENT_DIR, "postmortems", "POSTMORTEM-INDEX.md");
const PM_DIR = join(CONTENT_DIR, "postmortems");
const BLOG_INDEX = join(CONTENT_DIR, "blog", "BLOG-INDEX.md");
const BLOG_DIR = join(CONTENT_DIR, "blog");
const CAPTURES_DIR = join(WORK_DIR, "captures");
const GHOST_CLI = join(
  homedir(),
  "EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/ghost-cli.ts"
);

// =============================================================================
// Capture Types
// =============================================================================

interface CaptureExchange {
  role: "user" | "assistant";
  content: string;
}

interface Capture {
  id: string;
  timestamp: string;
  source: "USER" | "AI-SUGGESTED";
  status: "confirmed" | "pending";
  exchange: CaptureExchange[];
  note?: string;
  context?: string;
}

interface CaptureSession {
  session: string;
  created: string;
  context?: string;
  captures: Capture[];
}

// =============================================================================
// Timeline Verification Types
// =============================================================================

interface TemporalClaim {
  text: string;
  pattern: string;
  line: number;
  context: string;  // surrounding text
}

interface TimelineFact {
  source: string;  // "git", "deployment", "work-session"
  description: string;
  timestamp: string;
  details?: string;
}

interface VerificationResult {
  claims: TemporalClaim[];
  facts: TimelineFact[];
  warnings: string[];
}

// Patterns that suggest temporal claims worth verifying
const TEMPORAL_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  // Vague durations
  { pattern: /for (weeks|months|years|ages|a long time)/gi, category: "vague-duration" },
  { pattern: /(weeks|months|years) ago/gi, category: "vague-past" },
  { pattern: /been (dealing|struggling|working|fighting) with .* for/gi, category: "duration-claim" },

  // Relative timing
  { pattern: /could have (caught|detected|found|prevented) .* (earlier|sooner|months ago)/gi, category: "missed-opportunity" },
  { pattern: /had been (happening|occurring|broken|failing) for/gi, category: "duration-claim" },
  { pattern: /since (we started|the beginning|day one)/gi, category: "origin-claim" },

  // Quantified claims
  { pattern: /dozens of (deployments|commits|changes|fixes)/gi, category: "quantity-claim" },
  { pattern: /multiple (incidents|failures|outages)/gi, category: "quantity-claim" },
  { pattern: /countless (hours|times|attempts)/gi, category: "quantity-claim" },

  // Emotional/narrative inflation
  { pattern: /(finally|at last) (fixed|solved|resolved)/gi, category: "resolution-narrative" },
  { pattern: /after (much|considerable|extensive) (effort|work|debugging)/gi, category: "effort-narrative" },
];

// =============================================================================
// Multi-Audience Adaptation
// =============================================================================

const AUDIENCES = {
  technical: { key: "technical", label: "Builders", fabricPattern: null as string | null, ghostTag: "audience-technical", suffix: "" },
  aspiring:  { key: "aspiring",  label: "Aspiring Builders", fabricPattern: "adapt_for_aspiring", ghostTag: "audience-aspiring", suffix: ".aspiring" },
  general:   { key: "general",   label: "General", fabricPattern: "adapt_for_general", ghostTag: "audience-general", suffix: ".general" },
} as const;

type AudienceKey = keyof typeof AUDIENCES;

function getVariantPath(sourcePath: string, audience: AudienceKey): string {
  if (audience === "technical") return sourcePath;
  const suffix = AUDIENCES[audience].suffix;
  // blog-post-29-foo.md → blog-post-29-foo.aspiring.md
  return sourcePath.replace(/\.md$/, `${suffix}.md`);
}

function getSourceFromVariant(variantPath: string): string {
  // blog-post-29-foo.aspiring.md → blog-post-29-foo.md
  return variantPath.replace(/\.(aspiring|general)\.md$/, ".md");
}

function getSeriesTag(sourcePath: string): string {
  // Extract slug from filename for series linking
  // blog-post-29-five-bugs-one-root-cause.md → series-five-bugs-one-root-cause
  const base = basename(sourcePath, ".md");
  const slug = base.replace(/^blog-post-\d+-/, "").replace(/^postmortem-\d+-/, "");
  return `series-${slug}`;
}

function getExistingVariants(sourcePath: string): { audience: AudienceKey; path: string; exists: boolean }[] {
  return (Object.keys(AUDIENCES) as AudienceKey[]).map(key => {
    const variantPath = getVariantPath(sourcePath, key);
    return {
      audience: key,
      path: variantPath,
      exists: existsSync(variantPath),
    };
  });
}

const STATE_SERVICE_URL = process.env.PAI_STATE_SERVICE_URL || "https://pai-state.escape-velocity-ventures.org";

// =============================================================================
// Sanitization Patterns - Strip metadata injected by fabric patterns
// =============================================================================

/**
 * Patterns that fabric's improve_writing and similar patterns may inject.
 * These should be stripped before saving to source files.
 */
const SANITIZE_PATTERNS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
  // Author/Published/Series metadata block (with optional surrounding whitespace)
  {
    pattern: /\n*\*\*Author:\*\*[^\n]*\n\*\*Published:\*\*[^\n]*\n\*\*Series:\*\*[^\n]*\n*/gi,
    replacement: "\n",
    description: "Author/Published/Series metadata block",
  },
  // Individual metadata lines
  {
    pattern: /^\*\*Author:\*\*.*$\n?/gim,
    replacement: "",
    description: "Author metadata line",
  },
  {
    pattern: /^\*\*Published:\*\*.*$\n?/gim,
    replacement: "",
    description: "Published metadata line",
  },
  {
    pattern: /^\*\*Series:\*\*.*$\n?/gim,
    replacement: "",
    description: "Series metadata line",
  },
  // Status metadata
  {
    pattern: /^\*\*Status:\*\*.*$\n?/gim,
    replacement: "",
    description: "Status metadata",
  },
  // Created metadata
  {
    pattern: /^\*\*Created:\*\*.*$\n?/gim,
    replacement: "",
    description: "Created metadata",
  },
  // Assets table section
  {
    pattern: /## Assets\s*\n\s*\|[^]*?\n\n/gm,
    replacement: "",
    description: "Assets table section",
  },
  // Publication Checklist section
  {
    pattern: /## Publication Checklist\s*\n[^]*?(?=\n## |\n---|\*This is Post)/gm,
    replacement: "",
    description: "Publication Checklist section",
  },
  // "Copy assets to final blog" notes
  {
    pattern: /^.*Copy assets to final blog.*$\n?/gim,
    replacement: "",
    description: "Copy assets note",
  },
  // Draft ready notes
  {
    pattern: /^.*Draft ready for review.*$\n?/gim,
    replacement: "",
    description: "Draft ready note",
  },
  // Clean up excessive blank lines (more than 2 in a row)
  {
    pattern: /\n{4,}/g,
    replacement: "\n\n\n",
    description: "Excessive blank lines",
  },
];

function sanitizeContent(content: string): { sanitized: string; changes: string[] } {
  let sanitized = content;
  const changes: string[] = [];

  for (const { pattern, replacement, description } of SANITIZE_PATTERNS) {
    const before = sanitized;
    sanitized = sanitized.replace(pattern, replacement);
    if (before !== sanitized) {
      changes.push(description);
    }
  }

  // Trim leading/trailing whitespace but preserve single trailing newline
  sanitized = sanitized.trim() + "\n";

  return { sanitized, changes };
}

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
    mkdirSync(PM_DIR, { recursive: true });

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
  variants?: string; // "T" | "T A" | "T A G" etc
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
      /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*`?([^`|]+)`?\s*\|(?:\s*([^|]*)\s*\|)?(?:\s*([^|]*)\s*\|)?/
    );
    if (match && section) {
      const entry: BlogEntry = {
        blogNumber: parseInt(match[1]),
        date: match[2].trim(),
        title: match[3].trim(),
        source: match[4].trim(),
        type: match[5]?.trim() || "Post",
        variants: match[6]?.trim() || undefined,
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

  const variants = entry.variants || "T";
  const newRow = `| ${String(entry.blogNumber).padStart(2, "0")} | ${entry.date} | ${entry.title} | \`${entry.source}\` | ${entry.type} | ${variants} |`;

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
  mkdirSync(PM_DIR, { recursive: true });
  const filepath = join(PM_DIR, filename);

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

async function pmPromote(pmNumber: string, skipVerify: boolean = false): Promise<void> {
  const entries = parsePostmortemIndex();
  const entry = entries.find(
    (e) => e.pmNumber.toUpperCase() === pmNumber.toUpperCase()
  );

  if (!entry) {
    console.error(`\n❌ Postmortem not found: ${pmNumber}\n`);
    process.exit(1);
  }

  // entry.file is just the filename for pmCreate-generated entries,
  // or a relative path like "WORK/..." for older ISC-only entries
  const filepath = entry.file.startsWith("WORK/")
    ? join(MEMORY_DIR, entry.file)
    : join(PM_DIR, entry.file);
  if (!existsSync(filepath)) {
    console.error(`\n❌ File not found: ${filepath}\n`);
    process.exit(1);
  }

  // Timeline verification step
  if (!skipVerify) {
    const content = readFileSync(filepath, "utf-8");
    const claims = extractTemporalClaims(content);

    if (claims.length > 0) {
      console.log(`\n⚠️  Timeline Verification Warning\n`);
      console.log(`Found ${claims.length} temporal claim(s) that may need review:\n`);

      for (const claim of claims) {
        console.log(`   Line ${claim.line}: "${claim.text}"`);
        console.log(`   Category: ${claim.pattern}\n`);
      }

      console.log(`${"─".repeat(50)}`);
      console.log(`\n💡 Consider verifying these claims against actual data:`);
      console.log(`   content-cli blog verify "${filepath}"\n`);
      console.log(`To proceed anyway, use: content-cli pm promote ${pmNumber} --skip-verify\n`);

      // Pause for 5 seconds to let user see the warning
      console.log(`Proceeding in 5 seconds... (Ctrl+C to cancel)\n`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else {
      console.log(`\n✅ Timeline check passed - no vague temporal claims detected.\n`);
    }
  }

  // Get next blog number
  const blogNumber = getNextBlogNumber();

  // Create Ghost draft
  console.log(`Creating Ghost draft for ${pmNumber}...`);
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

type RateMode = "single" | "drafts" | "published";

async function blogRate(
  target: string,
  mode: RateMode,
  pattern: RatingPattern = "rate_blog_post"
): Promise<void> {
  const BLOG_DIR = join(MEMORY_DIR, "WORK", "blog");
  const PM_DIR = join(MEMORY_DIR, "WORK", "postmortems");

  console.log(`\nUsing pattern: ${pattern}\n`);

  if (mode === "drafts" || mode === "published") {
    const { published, drafts } = parseBlogIndex();
    const posts = mode === "drafts" ? drafts : published;
    const label = mode === "drafts" ? "drafts" : "published posts";

    if (posts.length === 0) {
      console.log(`No ${label} to rate.\n`);
      return;
    }

    console.log(`Rating ${posts.length} ${label}...\n`);
    const ratings: RatingResult[] = [];

    for (const post of posts) {
      // Find the source file
      let filepath = "";
      if (post.source.includes("Ghost draft")) {
        console.log(`  ⚠ Skipping ${post.title} (Ghost-only, no local file)`);
        continue;
      }

      // Check blog dir first, then postmortems
      const blogPath = join(BLOG_DIR, post.source);
      const pmPath = join(PM_DIR, post.source);

      if (existsSync(blogPath)) {
        filepath = blogPath;
      } else if (existsSync(pmPath)) {
        filepath = pmPath;
      } else {
        console.log(`  ⚠ Skipping ${post.title} (file not found: ${post.source})`);
        continue;
      }

      process.stdout.write(`  Rating: ${post.title.slice(0, 40)}...`);
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
// Blog Improve - Safe fabric wrapper with sanitization
// =============================================================================

interface ImproveOptions {
  dryRun?: boolean;
  noConfirm?: boolean;
  pattern?: string;
}

async function blogImprove(filepath: string, options: ImproveOptions = {}): Promise<void> {
  const BLOG_DIR = join(MEMORY_DIR, "WORK", "blog");
  const PM_DIR = join(MEMORY_DIR, "WORK", "postmortems");

  // Resolve file path
  let resolvedPath = filepath;
  if (!existsSync(resolvedPath)) {
    const blogPath = join(BLOG_DIR, filepath);
    const pmPath = join(PM_DIR, filepath);

    if (existsSync(blogPath)) {
      resolvedPath = blogPath;
    } else if (existsSync(pmPath)) {
      resolvedPath = pmPath;
    } else if (existsSync(filepath + ".md")) {
      resolvedPath = filepath + ".md";
    } else {
      console.error(`\n❌ File not found: ${filepath}`);
      console.error(`   Tried: ${filepath}, ${blogPath}, ${pmPath}\n`);
      process.exit(1);
    }
  }

  const originalContent = readFileSync(resolvedPath, "utf-8");
  const fabricPattern = options.pattern || "improve_writing";

  console.log(`\n🔧 Improving: ${basename(resolvedPath)}`);
  console.log(`   Using fabric pattern: ${fabricPattern}\n`);

  // Step 1: Run fabric
  // Use fabric's default model (configured in fabric settings) for best compatibility
  console.log("📝 Running fabric improve_writing...");
  let improvedContent: string;
  try {
    improvedContent = execSync(
      `cat "${resolvedPath}" | fabric-ai -p ${fabricPattern}`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: "/bin/bash" }
    );
  } catch (error) {
    console.error(`\n❌ Fabric failed: ${(error as Error).message}\n`);
    process.exit(1);
  }

  // Step 2: Sanitize output
  console.log("🧹 Sanitizing output (removing injected metadata)...");
  const { sanitized, changes } = sanitizeContent(improvedContent);

  if (changes.length > 0) {
    console.log(`   Stripped: ${changes.join(", ")}`);
  } else {
    console.log("   No metadata to strip");
  }

  // Step 3: Run lint check
  console.log("🔍 Running lint check...");
  const lintResult = execSync(
    `bun run "${GHOST_CLI}" lint "${resolvedPath}" 2>&1 || true`,
    { encoding: "utf-8", shell: "/bin/bash" }
  );

  // Quick lint on the sanitized content (check for remaining issues)
  const remainingIssues: string[] = [];
  const lintPatterns = [
    { pattern: /\*\*Status:\*\*.*Draft/i, name: "Status metadata" },
    { pattern: /\*\*Author:\*\*/i, name: "Author metadata" },
    { pattern: /## Assets\s*\n\s*\|/m, name: "Assets table" },
    { pattern: /Publication Checklist/i, name: "Publication Checklist" },
    { pattern: /\[TODO[:\]]?/i, name: "TODO marker" },
  ];

  for (const { pattern, name } of lintPatterns) {
    if (pattern.test(sanitized)) {
      remainingIssues.push(name);
    }
  }

  if (remainingIssues.length > 0) {
    console.log(`   ⚠️  Warnings: ${remainingIssues.join(", ")}`);
  } else {
    console.log("   ✅ Lint passed");
  }

  // Step 4: Show diff
  console.log(`\n${"─".repeat(60)}`);
  console.log("DIFF PREVIEW");
  console.log(`${"─".repeat(60)}`);

  // Simple line-based diff
  const origLines = originalContent.split("\n");
  const newLines = sanitized.split("\n");

  const maxLines = Math.max(origLines.length, newLines.length);
  let changedLines = 0;

  for (let i = 0; i < Math.min(maxLines, 50); i++) {
    const orig = origLines[i] || "";
    const newLine = newLines[i] || "";
    if (orig !== newLine) {
      changedLines++;
      if (changedLines <= 20) {
        if (orig && !newLine) {
          console.log(`- L${i + 1}: ${orig.substring(0, 70)}${orig.length > 70 ? "..." : ""}`);
        } else if (!orig && newLine) {
          console.log(`+ L${i + 1}: ${newLine.substring(0, 70)}${newLine.length > 70 ? "..." : ""}`);
        } else {
          console.log(`~ L${i + 1}:`);
          console.log(`  - ${orig.substring(0, 60)}${orig.length > 60 ? "..." : ""}`);
          console.log(`  + ${newLine.substring(0, 60)}${newLine.length > 60 ? "..." : ""}`);
        }
      }
    }
  }

  if (changedLines > 20) {
    console.log(`   ... and ${changedLines - 20} more changed lines`);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Total: ${changedLines} lines changed | Original: ${origLines.length} lines | New: ${newLines.length} lines`);
  console.log(`${"─".repeat(60)}\n`);

  // Step 5: Dry run check
  if (options.dryRun) {
    console.log("🔵 DRY RUN - No changes written\n");
    console.log("To apply changes, run without --dry-run\n");
    return;
  }

  // Step 6: Confirm and save
  if (!options.noConfirm) {
    console.log("⚠️  This will overwrite the original file.");
    console.log("   To skip confirmation, use --yes flag.\n");
    console.log("   Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n");

    // Auto-proceed after timeout (for non-interactive use, user can Ctrl+C)
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Write the sanitized content
  writeFileSync(resolvedPath, sanitized);
  console.log(`✅ Saved improved content to: ${resolvedPath}\n`);

  // Suggest next steps
  console.log("Next steps:");
  console.log(`  1. Review changes: git diff "${resolvedPath}"`);
  console.log(`  2. Lint check: ghost-cli lint "${resolvedPath}"`);
  console.log(`  3. If updating Ghost: ghost-cli update <slug> --file "${resolvedPath}"\n`);
}

// =============================================================================
// Blog Adapt - Multi-audience variant generation
// =============================================================================

interface AdaptOptions {
  audience?: AudienceKey;
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

async function blogAdapt(filepath: string, options: AdaptOptions = {}): Promise<void> {
  // Resolve file path (same logic as blogImprove)
  let resolvedPath = filepath;
  if (!existsSync(resolvedPath)) {
    const blogPath = join(BLOG_DIR, filepath);
    const pmPath = join(PM_DIR, filepath);

    if (existsSync(blogPath)) {
      resolvedPath = blogPath;
    } else if (existsSync(pmPath)) {
      resolvedPath = pmPath;
    } else if (existsSync(filepath + ".md")) {
      resolvedPath = filepath + ".md";
    } else {
      console.error(`\n❌ File not found: ${filepath}`);
      console.error(`   Tried: ${filepath}, ${join(BLOG_DIR, filepath)}, ${join(PM_DIR, filepath)}\n`);
      process.exit(1);
    }
  }

  // Ensure we're working with the source (technical) file, not a variant
  const sourcePath = getSourceFromVariant(resolvedPath);
  if (sourcePath !== resolvedPath) {
    console.error(`\n❌ "${basename(resolvedPath)}" is a variant file. Use the source file instead:`);
    console.error(`   ${basename(sourcePath)}\n`);
    process.exit(1);
  }

  const sourceContent = readFileSync(resolvedPath, "utf-8");

  // Determine which audiences to generate
  let targetAudiences: AudienceKey[];
  if (options.all) {
    targetAudiences = ["aspiring", "general"];
  } else if (options.audience && options.audience !== "technical") {
    targetAudiences = [options.audience];
  } else {
    console.error("\n❌ Specify an audience or use --all:");
    console.error("   content-cli blog adapt <file> --audience aspiring");
    console.error("   content-cli blog adapt <file> --audience general");
    console.error("   content-cli blog adapt <file> --all\n");
    process.exit(1);
  }

  console.log(`\n📝 Adapting: ${basename(resolvedPath)}`);
  console.log(`   Source audience: Builders (technical)`);
  console.log(`   Target audience(s): ${targetAudiences.map(a => AUDIENCES[a].label).join(", ")}\n`);

  for (const audienceKey of targetAudiences) {
    const audience = AUDIENCES[audienceKey];
    const variantPath = getVariantPath(resolvedPath, audienceKey);

    // Check if variant already exists
    if (existsSync(variantPath) && !options.force) {
      console.log(`   ⏭️  ${audience.label}: ${basename(variantPath)} already exists (use --force to overwrite)`);
      continue;
    }

    console.log(`   🔄 Generating ${audience.label} variant...`);

    // Run fabric pattern
    let adaptedContent: string;
    try {
      adaptedContent = execSync(
        `cat "${resolvedPath}" | fabric-ai -p ${audience.fabricPattern}`,
        { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: "/bin/bash" }
      );
    } catch (error) {
      console.error(`   ❌ Fabric failed for ${audience.label}: ${(error as Error).message}`);
      continue;
    }

    // Sanitize output (same as blogImprove)
    const { sanitized, changes } = sanitizeContent(adaptedContent);
    if (changes.length > 0) {
      console.log(`   🧹 Stripped: ${changes.join(", ")}`);
    }

    // Show diff preview
    const origLines = sourceContent.split("\n").length;
    const newLines = sanitized.split("\n").length;
    const ratio = Math.round((newLines / origLines) * 100);
    console.log(`   📊 ${origLines} lines → ${newLines} lines (${ratio}% of original)`);

    if (options.dryRun) {
      console.log(`   🔵 DRY RUN - would save to: ${basename(variantPath)}`);
      // Show first 10 lines as preview
      const preview = sanitized.split("\n").slice(0, 10).join("\n");
      console.log(`\n   Preview:\n${preview.split("\n").map(l => "   │ " + l).join("\n")}\n`);
      continue;
    }

    // Save variant
    writeFileSync(variantPath, sanitized);
    console.log(`   ✅ Saved: ${basename(variantPath)}`);
  }

  if (!options.dryRun) {
    console.log(`\nNext steps:`);
    console.log(`  1. Review variants in ${basename(BLOG_DIR)}/`);
    console.log(`  2. Publish all: content-cli blog publish-variants ${basename(resolvedPath)}\n`);
  }
}

// =============================================================================
// Blog Publish Variants - Create Ghost drafts for all audience variants
// =============================================================================

async function blogPublishVariants(filepath: string): Promise<void> {
  // Resolve file path
  let resolvedPath = filepath;
  if (!existsSync(resolvedPath)) {
    const blogPath = join(BLOG_DIR, filepath);
    const pmPath = join(PM_DIR, filepath);

    if (existsSync(blogPath)) {
      resolvedPath = blogPath;
    } else if (existsSync(pmPath)) {
      resolvedPath = pmPath;
    } else {
      console.error(`\n❌ File not found: ${filepath}\n`);
      process.exit(1);
    }
  }

  // Ensure we're working with the source file
  const sourcePath = getSourceFromVariant(resolvedPath);
  if (sourcePath !== resolvedPath) {
    resolvedPath = sourcePath;
  }

  const seriesTag = getSeriesTag(resolvedPath);
  const variants = getExistingVariants(resolvedPath);
  const existingVariants = variants.filter(v => v.exists);

  if (existingVariants.length === 0) {
    console.error(`\n❌ No variant files found for ${basename(resolvedPath)}`);
    console.error(`   Run 'content-cli blog adapt ${basename(resolvedPath)} --all' first.\n`);
    process.exit(1);
  }

  console.log(`\n📤 Publishing variants for: ${basename(resolvedPath)}`);
  console.log(`   Series tag: ${seriesTag}`);
  console.log(`   Found ${existingVariants.length} variant(s)\n`);

  for (const variant of existingVariants) {
    const audience = AUDIENCES[variant.audience];
    const tags = [audience.ghostTag, seriesTag];

    console.log(`   📝 ${audience.label}: ${basename(variant.path)}`);
    console.log(`      Tags: ${tags.join(", ")}`);

    try {
      execSync(
        `bun run "${GHOST_CLI}" create --file "${variant.path}" --tags "${tags.join(",")}"`,
        { stdio: "inherit" }
      );
      console.log(`      ✅ Ghost draft created\n`);
    } catch (error) {
      console.error(`      ❌ Failed to create Ghost draft: ${(error as Error).message}\n`);
    }
  }

  console.log(`✅ Done! ${existingVariants.length} Ghost draft(s) created with series tag "${seriesTag}"\n`);
}

// =============================================================================
// Blog Adapt List - Show variant status for all indexed posts
// =============================================================================

function blogAdaptList(): void {
  const { published, drafts } = parseBlogIndex();
  const allPosts = [...published, ...drafts];

  if (allPosts.length === 0) {
    console.log("\nNo blog posts found.\n");
    return;
  }

  console.log(`\n  Multi-Audience Variant Status`);
  console.log(`  ${"═".repeat(65)}\n`);

  for (const post of allPosts) {
    // Resolve source file path
    let sourcePath = "";
    const blogPath = join(BLOG_DIR, post.source);
    const pmPath = join(PM_DIR, post.source);

    if (post.source.includes("Ghost draft") || post.source.includes("(Ghost draft only)")) {
      console.log(`  Blog #${String(post.blogNumber).padStart(2, "0")}: ${post.title}`);
      console.log(`    ☁️  Ghost-only (no local file for adaptation)\n`);
      continue;
    }

    if (existsSync(blogPath)) {
      sourcePath = blogPath;
    } else if (existsSync(pmPath)) {
      sourcePath = pmPath;
    } else {
      console.log(`  Blog #${String(post.blogNumber).padStart(2, "0")}: ${post.title}`);
      console.log(`    ⚠️  Source file not found: ${post.source}\n`);
      continue;
    }

    const variants = getExistingVariants(sourcePath);

    console.log(`  Blog #${String(post.blogNumber).padStart(2, "0")}: ${post.title}`);
    for (const v of variants) {
      const audience = AUDIENCES[v.audience];
      const icon = v.exists ? "+" : "-";
      const label = v.audience === "technical" ? `${audience.label}:` : `${audience.label}:`;
      const file = v.exists ? basename(v.path) : "(not adapted)";
      const suffix = v.audience === "technical" ? " (source)" : "";
      console.log(`    ${icon} ${label.padEnd(20)} ${file}${suffix}`);
    }
    console.log();
  }
}

// =============================================================================
// Blog Pull Variants - Fetch audience variants from Ghost back to local files
// =============================================================================

async function blogPullVariants(filepath: string): Promise<void> {
  // Resolve file path
  let resolvedPath = filepath;
  if (!existsSync(resolvedPath)) {
    const blogPath = join(BLOG_DIR, filepath);
    const pmPath = join(PM_DIR, filepath);

    if (existsSync(blogPath)) {
      resolvedPath = blogPath;
    } else if (existsSync(pmPath)) {
      resolvedPath = pmPath;
    } else {
      console.error(`\n❌ File not found: ${filepath}\n`);
      process.exit(1);
    }
  }

  // Ensure we're working with the source file
  const sourcePath = getSourceFromVariant(resolvedPath);
  if (sourcePath !== resolvedPath) {
    resolvedPath = sourcePath;
  }

  const seriesTag = getSeriesTag(resolvedPath);

  console.log(`\n🔍 Searching Ghost for posts tagged: ${seriesTag}`);

  // Use ghost-cli search-tag to find matching posts
  let output: string;
  try {
    output = execSync(
      `bun run "${GHOST_CLI}" search-tag "${seriesTag}" 2>&1`,
      { encoding: "utf-8" }
    );
  } catch {
    console.log(`   No posts found with tag "${seriesTag}" in Ghost.\n`);
    return;
  }

  // For each audience, find the matching Ghost post and pull it
  const audienceKeys: AudienceKey[] = ["technical", "aspiring", "general"];

  for (const audienceKey of audienceKeys) {
    const audience = AUDIENCES[audienceKey];
    const variantPath = getVariantPath(resolvedPath, audienceKey);

    // Search for the specific audience tag
    console.log(`\n   🔄 Looking for ${audience.label} variant (tag: ${audience.ghostTag})...`);

    let searchOutput: string;
    try {
      searchOutput = execSync(
        `bun run "${GHOST_CLI}" search-tag "${audience.ghostTag}" 2>&1`,
        { encoding: "utf-8" }
      );
    } catch {
      console.log(`      No posts found with tag "${audience.ghostTag}"`);
      continue;
    }

    // Parse the search output to find posts that also have the series tag
    // We need to find the slug of the post that has BOTH the audience tag and series tag
    // Use ghost-cli's output format: slug lines start with spaces and contain the slug
    const slugMatches = searchOutput.match(/^\s+[✓○]\s+(\S+)/gm);
    if (!slugMatches || slugMatches.length === 0) {
      console.log(`      No posts with tag "${audience.ghostTag}"`);
      continue;
    }

    // For each candidate, check if it also has the series tag
    let pulled = false;
    for (const slugLine of slugMatches) {
      const slug = slugLine.trim().replace(/^[✓○]\s+/, "");

      // Pull the post with tags to verify it has our series tag
      try {
        const pullOutput = execSync(
          `bun run "${GHOST_CLI}" pull "${slug}" --file "${variantPath}" 2>&1`,
          { encoding: "utf-8" }
        );

        // Check if this post has our series tag (it's in the pull output)
        if (pullOutput.includes(seriesTag) || audienceKey === "technical") {
          console.log(`      ✅ Pulled: ${basename(variantPath)}`);
          pulled = true;
          break;
        } else {
          // Wrong post - has the audience tag but not our series tag
          // Clean up the file we just wrote
          if (existsSync(variantPath) && audienceKey !== "technical") {
            const { unlinkSync } = await import("fs");
            unlinkSync(variantPath);
          }
        }
      } catch (error) {
        console.log(`      ❌ Failed to pull ${slug}: ${(error as Error).message}`);
      }
    }

    if (!pulled) {
      console.log(`      No matching post found for ${audience.label}`);
    }
  }

  console.log(`\n✅ Pull complete. Check files in ${basename(BLOG_DIR)}/\n`);
}

// =============================================================================
// Blog Pull Missing - Backfill Ghost-only posts with no local files
// =============================================================================

async function blogPullMissing(): Promise<void> {
  const { published, drafts } = parseBlogIndex();
  const allPosts = [...published, ...drafts];

  // Find entries that reference Ghost-only content
  const ghostOnly = allPosts.filter(p =>
    p.source.includes("Ghost draft") ||
    p.source.includes("(Ghost draft only)")
  );

  if (ghostOnly.length === 0) {
    console.log("\n✅ All blog entries have local files. Nothing to pull.\n");
    return;
  }

  console.log(`\n📥 Found ${ghostOnly.length} Ghost-only post(s) to pull.`);
  console.log(`   Fetching full Ghost post list for title matching...\n`);

  // Fetch all Ghost posts with full slugs and titles via ghost-cli get-all (JSON)
  // We shell out to ghost-cli but need full data. Use ghost-cli's list --json or
  // fetch directly. Simplest: use ghost-cli get for each candidate by trying the slug.
  // Better: add a JSON list output. Best: fetch the API ourselves.
  // Since ghost-cli's getAdminKey() handles auth, let's just call get for each,
  // trying Ghost's likely slug for each title.

  // Ghost slugifies titles as: lowercase, strip apostrophes, replace non-alphanum with -
  const ghostSlugify = (title: string) =>
    title.toLowerCase()
      .replace(/[''`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // Fetch full Ghost slug list once for prefix matching fallback
  let allGhostSlugs: string[] = [];
  try {
    const listOutput = execSync(
      `bun run "${GHOST_CLI}" list 2>&1`,
      { encoding: "utf-8" }
    );
    allGhostSlugs = listOutput.split("\n")
      .filter(l => l.match(/^\s+[✓○◐]\s+/))
      .map(l => {
        const parts = l.trim().split(/\s{2,}/);
        return parts[parts.length - 1] || "";
      })
      .filter(Boolean);
  } catch {
    // List failed; we'll rely on direct slug guessing
  }

  let pulled = 0;

  for (const post of ghostOnly) {
    console.log(`  Blog #${String(post.blogNumber).padStart(2, "0")}: ${post.title}`);

    // Generate target filename
    const titleSlug = ghostSlugify(post.title).slice(0, 60);
    const filename = `blog-post-${post.blogNumber}-${titleSlug}.md`;
    const filePath = join(BLOG_DIR, filename);

    if (existsSync(filePath)) {
      console.log(`     ⏭️  ${filename} already exists, skipping`);
      continue;
    }

    // Strategy: try exact slug, then -2 suffix, then prefix match against full list
    const exactSlug = ghostSlugify(post.title);
    const candidateSlugs = [
      exactSlug,
      exactSlug + "-2",
    ];

    // Prefix match: find Ghost slugs that start with our title slug
    const prefix = exactSlug.slice(0, 30);
    const prefixMatches = allGhostSlugs.filter(s => s.startsWith(prefix));
    for (const pm of prefixMatches) {
      if (!candidateSlugs.includes(pm)) {
        candidateSlugs.push(pm);
      }
    }

    let success = false;
    for (const slug of candidateSlugs) {
      try {
        execSync(
          `bun run "${GHOST_CLI}" pull "${slug}" --file "${filePath}" 2>&1`,
          { encoding: "utf-8" }
        );
        console.log(`     ✅ Pulled to: ${filename}`);
        pulled++;
        success = true;
        break;
      } catch {
        // Slug didn't match, try next
      }
    }

    if (!success) {
      console.log(`     ⚠️  No matching Ghost post found`);
      console.log(`         Tried: ${candidateSlugs.slice(0, 3).join(", ")}${candidateSlugs.length > 3 ? ` (+${candidateSlugs.length - 3} more)` : ""}`);
      console.log(`         Try manually: ghost-cli pull <actual-slug> --file "${filePath}"`);
    }
  }

  console.log(`\n📊 Pulled ${pulled}/${ghostOnly.length} posts.`);
  if (pulled > 0) {
    console.log(`   Update BLOG-INDEX.md source column to reference the new local files.`);
  }
  console.log();
}

// =============================================================================
// Capture Functions
// =============================================================================

function ensureCapturesDir(): void {
  if (!existsSync(CAPTURES_DIR)) {
    mkdirSync(CAPTURES_DIR, { recursive: true });
  }
}

function getSessionPath(sessionName: string): string {
  return join(CAPTURES_DIR, `${sessionName}.json`);
}

function getCurrentSession(): CaptureSession | null {
  ensureCapturesDir();
  const currentSessionFile = join(CAPTURES_DIR, ".current-session");
  if (!existsSync(currentSessionFile)) return null;

  const sessionName = readFileSync(currentSessionFile, "utf-8").trim();
  const sessionPath = getSessionPath(sessionName);

  if (!existsSync(sessionPath)) return null;
  return JSON.parse(readFileSync(sessionPath, "utf-8"));
}

function saveSession(session: CaptureSession): void {
  ensureCapturesDir();
  const sessionPath = getSessionPath(session.session);
  writeFileSync(sessionPath, JSON.stringify(session, null, 2));

  // Also write human-readable markdown
  const mdPath = sessionPath.replace(".json", ".md");
  writeFileSync(mdPath, sessionToMarkdown(session));
}

function setCurrentSession(sessionName: string): void {
  ensureCapturesDir();
  const currentSessionFile = join(CAPTURES_DIR, ".current-session");
  writeFileSync(currentSessionFile, sessionName);
}

function sessionToMarkdown(session: CaptureSession): string {
  let md = `# Captures: ${session.session}\n\n`;
  md += `**Created:** ${session.created}\n`;
  if (session.context) {
    md += `**Context:** ${session.context}\n`;
  }
  md += `\n---\n\n`;

  const confirmed = session.captures.filter(c => c.status === "confirmed");
  const pending = session.captures.filter(c => c.status === "pending");

  if (confirmed.length > 0) {
    md += `## Confirmed Captures (${confirmed.length})\n\n`;
    for (const cap of confirmed) {
      md += formatCaptureMarkdown(cap);
    }
  }

  if (pending.length > 0) {
    md += `## Pending Review (${pending.length})\n\n`;
    for (const cap of pending) {
      md += formatCaptureMarkdown(cap);
    }
  }

  if (session.captures.length === 0) {
    md += "_No captures yet._\n";
  }

  return md;
}

function formatCaptureMarkdown(cap: Capture): string {
  const time = new Date(cap.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const source = cap.source === "USER" ? "📌 USER-TAGGED" : "🤖 AI-SUGGESTED";

  let md = `### [${time}] ${source}\n\n`;

  for (const ex of cap.exchange) {
    const prefix = ex.role === "user" ? "**User:**" : "**Assistant:**";
    md += `> ${prefix} ${ex.content}\n\n`;
  }

  if (cap.note) {
    md += `_Note: ${cap.note}_\n\n`;
  }

  md += `---\n\n`;
  return md;
}

function getNextCaptureId(session: CaptureSession): string {
  const num = session.captures.length + 1;
  return `cap-${String(num).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// capture start
// ---------------------------------------------------------------------------

async function captureStart(name: string, context?: string): Promise<void> {
  ensureCapturesDir();

  // Generate session name from date + provided name
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  const sessionName = `${dateStr}-${slug}`;

  const sessionPath = getSessionPath(sessionName);

  if (existsSync(sessionPath)) {
    console.log(`📁 Session already exists: ${sessionName}`);
    console.log(`   Resuming existing session.\n`);
    setCurrentSession(sessionName);
    const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
    console.log(`   Captures so far: ${session.captures.length}`);
    return;
  }

  const session: CaptureSession = {
    session: sessionName,
    created: new Date().toISOString(),
    context: context,
    captures: [],
  };

  saveSession(session);
  setCurrentSession(sessionName);

  console.log(`✅ Started capture session: ${sessionName}`);
  if (context) {
    console.log(`   Context: ${context}`);
  }
  console.log(`\n   Use 'content-cli capture save "note"' to capture exchanges.`);
  console.log(`   Use 'content-cli capture list' to see captures.\n`);
}

// ---------------------------------------------------------------------------
// capture save (user-tagged)
// ---------------------------------------------------------------------------

async function captureSave(
  userContent: string,
  assistantContent: string,
  note?: string
): Promise<void> {
  const session = getCurrentSession();

  if (!session) {
    console.error("❌ No active capture session.");
    console.error("   Start one with: content-cli capture start <name>\n");
    process.exit(1);
  }

  const capture: Capture = {
    id: getNextCaptureId(session),
    timestamp: new Date().toISOString(),
    source: "USER",
    status: "confirmed",
    exchange: [
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent },
    ],
    note: note,
    context: session.context,
  };

  session.captures.push(capture);
  saveSession(session);

  console.log(`✅ Captured exchange as ${capture.id}`);
  if (note) {
    console.log(`   Note: ${note}`);
  }
  console.log(`   Total captures in session: ${session.captures.length}\n`);
}

// ---------------------------------------------------------------------------
// capture suggest (AI-suggested)
// ---------------------------------------------------------------------------

async function captureSuggest(
  userContent: string,
  assistantContent: string,
  pattern?: string
): Promise<void> {
  const session = getCurrentSession();

  if (!session) {
    console.error("❌ No active capture session.");
    console.error("   Start one with: content-cli capture start <name>\n");
    process.exit(1);
  }

  const capture: Capture = {
    id: getNextCaptureId(session),
    timestamp: new Date().toISOString(),
    source: "AI-SUGGESTED",
    status: "pending",
    exchange: [
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent },
    ],
    note: pattern ? `Pattern: ${pattern}` : undefined,
    context: session.context,
  };

  session.captures.push(capture);
  saveSession(session);

  console.log(`🤖 Suggested capture: ${capture.id} (pending review)`);
  if (pattern) {
    console.log(`   Pattern: ${pattern}`);
  }
  console.log(`   Use 'content-cli capture review' to approve/reject.\n`);
}

// ---------------------------------------------------------------------------
// capture list
// ---------------------------------------------------------------------------

function captureList(): void {
  const session = getCurrentSession();

  if (!session) {
    console.log("📭 No active capture session.\n");

    // List available sessions
    ensureCapturesDir();
    const files = execSync(`ls -1 "${CAPTURES_DIR}"/*.json 2>/dev/null || true`, { encoding: "utf-8" })
      .split("\n")
      .filter(f => f.trim() && !f.includes(".current-session"));

    if (files.length > 0) {
      console.log("Available sessions:");
      for (const f of files) {
        const name = basename(f, ".json");
        console.log(`  - ${name}`);
      }
      console.log(`\nResume with: content-cli capture start <session-name>\n`);
    }
    return;
  }

  console.log(`📋 Session: ${session.session}`);
  console.log(`   Created: ${session.created}`);
  if (session.context) {
    console.log(`   Context: ${session.context}`);
  }
  console.log();

  const confirmed = session.captures.filter(c => c.status === "confirmed");
  const pending = session.captures.filter(c => c.status === "pending");

  if (confirmed.length > 0) {
    console.log(`✅ Confirmed (${confirmed.length}):`);
    for (const cap of confirmed) {
      const time = new Date(cap.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      });
      const preview = cap.exchange[0].content.substring(0, 50);
      console.log(`   ${cap.id} [${time}] "${preview}..."`);
      if (cap.note) console.log(`            Note: ${cap.note}`);
    }
    console.log();
  }

  if (pending.length > 0) {
    console.log(`⏳ Pending review (${pending.length}):`);
    for (const cap of pending) {
      const time = new Date(cap.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      });
      const preview = cap.exchange[0].content.substring(0, 50);
      console.log(`   ${cap.id} [${time}] "${preview}..."`);
      if (cap.note) console.log(`            ${cap.note}`);
    }
    console.log();
  }

  if (session.captures.length === 0) {
    console.log("   No captures yet.\n");
  }

  console.log(`   Total: ${session.captures.length} captures (${confirmed.length} confirmed, ${pending.length} pending)\n`);
}

// ---------------------------------------------------------------------------
// capture review
// ---------------------------------------------------------------------------

async function captureReview(action?: string, captureId?: string): Promise<void> {
  const session = getCurrentSession();

  if (!session) {
    console.error("❌ No active capture session.\n");
    process.exit(1);
  }

  const pending = session.captures.filter(c => c.status === "pending");

  if (pending.length === 0) {
    console.log("✅ No pending captures to review.\n");
    return;
  }

  if (!action) {
    // Show pending captures for review
    console.log(`⏳ Pending captures (${pending.length}):\n`);
    for (const cap of pending) {
      console.log(`${"─".repeat(60)}`);
      console.log(`${cap.id} - ${new Date(cap.timestamp).toLocaleString()}`);
      if (cap.note) console.log(`Pattern: ${cap.note}`);
      console.log();
      for (const ex of cap.exchange) {
        const label = ex.role === "user" ? "User" : "Assistant";
        console.log(`  ${label}: ${ex.content}`);
      }
      console.log();
    }
    console.log(`${"─".repeat(60)}`);
    console.log(`\nActions:`);
    console.log(`  content-cli capture review approve <id>   Confirm a capture`);
    console.log(`  content-cli capture review reject <id>    Remove a capture`);
    console.log(`  content-cli capture review approve-all    Confirm all pending`);
    console.log(`  content-cli capture review reject-all     Remove all pending\n`);
    return;
  }

  if (action === "approve-all") {
    for (const cap of pending) {
      cap.status = "confirmed";
    }
    saveSession(session);
    console.log(`✅ Approved ${pending.length} captures.\n`);
    return;
  }

  if (action === "reject-all") {
    session.captures = session.captures.filter(c => c.status !== "pending");
    saveSession(session);
    console.log(`🗑️  Rejected ${pending.length} captures.\n`);
    return;
  }

  if (!captureId) {
    console.error("❌ Please specify a capture ID.\n");
    process.exit(1);
  }

  const cap = session.captures.find(c => c.id === captureId);
  if (!cap) {
    console.error(`❌ Capture not found: ${captureId}\n`);
    process.exit(1);
  }

  if (action === "approve") {
    cap.status = "confirmed";
    saveSession(session);
    console.log(`✅ Approved: ${captureId}\n`);
  } else if (action === "reject") {
    session.captures = session.captures.filter(c => c.id !== captureId);
    saveSession(session);
    console.log(`🗑️  Rejected: ${captureId}\n`);
  } else {
    console.error(`❌ Unknown action: ${action}. Use 'approve' or 'reject'.\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// capture export
// ---------------------------------------------------------------------------

function captureExport(format?: string): void {
  const session = getCurrentSession();

  if (!session) {
    console.error("❌ No active capture session.\n");
    process.exit(1);
  }

  const confirmed = session.captures.filter(c => c.status === "confirmed");

  if (confirmed.length === 0) {
    console.log("📭 No confirmed captures to export.\n");
    return;
  }

  if (format === "json") {
    console.log(JSON.stringify(confirmed, null, 2));
    return;
  }

  // Default: markdown format for blog inclusion
  console.log(`## Captured Moments\n`);
  console.log(`_From session: ${session.session}_\n`);

  for (const cap of confirmed) {
    console.log(`### ${cap.note || "Exchange"}\n`);
    for (const ex of cap.exchange) {
      if (ex.role === "user") {
        console.log(`> **Me:** "${ex.content}"\n`);
      } else {
        console.log(`> **Aurelia:** "${ex.content}"\n`);
      }
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// capture clear
// ---------------------------------------------------------------------------

function captureClear(): void {
  ensureCapturesDir();
  const currentSessionFile = join(CAPTURES_DIR, ".current-session");

  if (existsSync(currentSessionFile)) {
    unlinkSync(currentSessionFile);
    console.log("✅ Cleared current session pointer.\n");
    console.log("   Session files are preserved in:");
    console.log(`   ${CAPTURES_DIR}\n`);
  } else {
    console.log("📭 No active session to clear.\n");
  }
}

// =============================================================================
// Timeline Verification Functions
// =============================================================================

function extractTemporalClaims(content: string): TemporalClaim[] {
  const claims: TemporalClaim[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { pattern, category } of TEMPORAL_PATTERNS) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(line)) !== null) {
        // Get surrounding context (current line plus neighbors)
        const contextStart = Math.max(0, i - 1);
        const contextEnd = Math.min(lines.length - 1, i + 1);
        const context = lines.slice(contextStart, contextEnd + 1).join("\n");

        claims.push({
          text: match[0],
          pattern: category,
          line: i + 1,
          context: context.trim(),
        });
      }
    }
  }

  return claims;
}

function detectProjectContext(content: string): string[] {
  const projects: string[] = [];
  const projectPatterns = [
    { pattern: /harmony/gi, project: "Harmony" },
    { pattern: /ghost/gi, project: "Ghost" },
    { pattern: /tinkerbelle/gi, project: "TinkerBelle" },
    { pattern: /supabase/gi, project: "Supabase" },
    { pattern: /grafana/gi, project: "Grafana" },
    { pattern: /prometheus/gi, project: "Prometheus" },
    { pattern: /pai[- ]?/gi, project: "PAI" },
  ];

  for (const { pattern, project } of projectPatterns) {
    if (pattern.test(content) && !projects.includes(project)) {
      projects.push(project);
    }
  }

  return projects;
}

async function getGitFacts(repoPath: string, since?: string): Promise<TimelineFact[]> {
  const facts: TimelineFact[] = [];

  try {
    const sinceArg = since ? `--since="${since}"` : "--since='30 days ago'";
    const cmd = `cd "${repoPath}" && git log ${sinceArg} --format="%H|%ad|%s" --date=iso 2>/dev/null | head -20`;
    const output = execSync(cmd, { encoding: "utf-8" });

    const commits = output.trim().split("\n").filter(Boolean);

    if (commits.length > 0) {
      const firstCommit = commits[commits.length - 1].split("|");
      const lastCommit = commits[0].split("|");

      facts.push({
        source: "git",
        description: `First commit in range: "${firstCommit[2]?.substring(0, 50)}"`,
        timestamp: firstCommit[1] || "unknown",
        details: `${commits.length} commits in period`,
      });

      facts.push({
        source: "git",
        description: `Latest commit: "${lastCommit[2]?.substring(0, 50)}"`,
        timestamp: lastCommit[1] || "unknown",
      });
    }
  } catch {
    // Git command failed, skip
  }

  return facts;
}

async function getDeploymentFacts(service?: string): Promise<TimelineFact[]> {
  const facts: TimelineFact[] = [];

  try {
    const cmd = `bun run ~/EscapeVelocity/TinkerBelle/cli/bluegreen/src/index.ts inventory 2>/dev/null`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });

    // Parse the inventory output
    const lines = output.split("\n").filter(l => l.includes("202"));  // Lines with timestamps

    for (const line of lines) {
      // Match lines like: "harmony  harmony  production  green   -          2026-01-28 18:39"
      const match = line.match(/(\w+)\s+(\w+)\s+(\w+)\s+(\w+)\s+\S+\s+([\d-]+\s+[\d:]+)/);
      if (match) {
        const [, svc, name, env, slot, timestamp] = match;
        if (!service || svc.toLowerCase() === service.toLowerCase()) {
          facts.push({
            source: "deployment",
            description: `${svc}/${name} deployed to ${env}/${slot}`,
            timestamp: timestamp,
          });
        }
      }
    }
  } catch {
    // TinkerBelle command failed, skip
  }

  return facts;
}

async function getWorkSessionFacts(topic?: string): Promise<TimelineFact[]> {
  const facts: TimelineFact[] = [];

  try {
    const workDirs = execSync(`ls -d ~/.claude/MEMORY/WORK/*/ 2>/dev/null`, { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter(Boolean);

    for (const dir of workDirs) {
      const dirName = basename(dir);
      if (topic && !dirName.toLowerCase().includes(topic.toLowerCase())) continue;

      const stat = execSync(`stat -f '%m' "${dir}" 2>/dev/null`, { encoding: "utf-8" }).trim();
      const timestamp = new Date(parseInt(stat) * 1000).toISOString();

      facts.push({
        source: "work-session",
        description: `Session: ${dirName.substring(0, 50)}`,
        timestamp: timestamp,
      });
    }
  } catch {
    // Directory listing failed, skip
  }

  return facts;
}

async function blogVerify(filepath: string, options: { project?: string; verbose?: boolean } = {}): Promise<void> {
  // Resolve file path
  let resolvedPath = filepath;
  if (!filepath.startsWith("/")) {
    resolvedPath = join(BLOG_DIR, filepath);
  }

  if (!existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}\n`);
    process.exit(1);
  }

  const content = readFileSync(resolvedPath, "utf-8");
  const filename = basename(resolvedPath);

  console.log(`\n🔍 Timeline Verification: ${filename}\n`);
  console.log("─".repeat(60));

  // Step 1: Extract temporal claims
  const claims = extractTemporalClaims(content);

  if (claims.length === 0) {
    console.log("\n✅ No temporal claims detected.\n");
    console.log("   This post appears to use factual timestamps or avoids vague time references.\n");
    return;
  }

  console.log(`\n⚠️  Found ${claims.length} temporal claim(s) to verify:\n`);

  for (const claim of claims) {
    console.log(`   Line ${claim.line}: "${claim.text}"`);
    console.log(`   Category: ${claim.pattern}`);
    if (options.verbose) {
      console.log(`   Context: ${claim.context.substring(0, 100)}...`);
    }
    console.log();
  }

  // Step 2: Detect project context
  const projects = detectProjectContext(content);
  console.log("─".repeat(60));
  console.log(`\n📦 Detected projects: ${projects.join(", ") || "none identified"}\n`);

  // Step 3: Gather facts from data sources
  console.log("─".repeat(60));
  console.log("\n📊 Gathering facts from data sources...\n");

  const allFacts: TimelineFact[] = [];

  // Git facts for detected projects
  const projectPaths: Record<string, string> = {
    Harmony: "~/EscapeVelocity/Harmony",
    TinkerBelle: "~/EscapeVelocity/TinkerBelle",
    PAI: "~/EscapeVelocity/PersonalAI/PAI",
    Ghost: "~/EscapeVelocity/TinkerBelle-config",  // Ghost config is here
  };

  for (const proj of projects) {
    const repoPath = projectPaths[proj];
    if (repoPath) {
      const gitFacts = await getGitFacts(repoPath.replace("~", homedir()));
      allFacts.push(...gitFacts);
    }
  }

  // Deployment facts
  for (const proj of projects) {
    const deployFacts = await getDeploymentFacts(proj);
    allFacts.push(...deployFacts);
  }

  // Work session facts
  const sessionFacts = await getWorkSessionFacts(projects[0]);
  allFacts.push(...sessionFacts.slice(0, 5));  // Limit to 5 most relevant

  if (allFacts.length === 0) {
    console.log("   No facts found from data sources.\n");
  } else {
    console.log(`   Found ${allFacts.length} relevant fact(s):\n`);
    for (const fact of allFacts.slice(0, 10)) {  // Show top 10
      console.log(`   [${fact.source}] ${fact.description}`);
      console.log(`            ${fact.timestamp}`);
      if (fact.details) console.log(`            ${fact.details}`);
      console.log();
    }
  }

  // Step 4: Summary
  console.log("─".repeat(60));
  console.log("\n📋 Summary:\n");
  console.log(`   Temporal claims found: ${claims.length}`);
  console.log(`   Facts gathered: ${allFacts.length}`);
  console.log(`   Projects detected: ${projects.length}`);

  if (claims.length > 0) {
    console.log("\n   ⚠️  Review these claims against the facts above.");
    console.log("   Consider replacing vague language with specific timestamps.\n");
  }

  console.log("\n💡 Suggested replacements:\n");
  for (const claim of claims) {
    console.log(`   "${claim.text}"`);
    console.log(`   → Consider: specific date/time, or "within X hours/days"\n`);
  }
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
  pm promote <PM-NNN> [--skip-verify]              Create Ghost draft (runs timeline check)

Blog Commands:
  blog add <file> [--date YYYY-MM-DD]              Add file to blog queue
  blog list [--drafts|--published|--all]           List blog entries
  blog sync                                        Sync status from Ghost
  blog rate <file> [--pattern X]                   Rate a single article (1-100)
  blog rate --all-drafts [--pattern X]             Rate all draft articles
  blog rate --published [--pattern X]              Rate all published articles
  blog status                                      Dashboard of drafts with file status
  blog improve <file> [options]                    Improve article via fabric (with safeguards)
  blog verify <file> [--verbose]                   Check temporal claims against actual data
  blog adapt <file> --audience aspiring|general    Generate audience variant
  blog adapt <file> --all [--force] [--dry-run]    Generate all audience variants
  blog adapt-list                                  Show variant status for all posts
  blog publish-variants <file>                     Create Ghost drafts for all variants
  blog pull-variants <file>                        Pull variants from Ghost to local files
  blog pull-missing                                Backfill Ghost-only posts to local files

Capture Commands:
  capture start <name> [--context "..."]           Start a capture session
  capture save <user> <assistant> [--note "..."]   Save user-tagged capture
  capture suggest <user> <assistant> [--pattern X] Save AI-suggested capture (pending)
  capture list                                     List captures in current session
  capture review [approve|reject] [id]             Review pending captures
  capture export [--json]                          Export captures as markdown/JSON
  capture clear                                    Clear current session pointer

Improve Options:
  --dry-run                 Preview changes without saving
  --yes                     Skip confirmation prompt
  --pattern <name>          Fabric pattern (default: improve_writing)

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
  "Rate published posts"           → blog rate --published
  "How good is this article?"      → blog rate <file>
  "Would I consume this?"          → blog rate <file> --pattern rate_content
  "Improve this article"           → blog improve <file>
  "Make this post better"          → blog improve <file>
  "Show blog status"               → blog status
  "Verify timeline claims"         → blog verify <file>
  "Check my timelines"             → blog verify <file>
  "Adapt for beginners"            → blog adapt <file> --audience aspiring
  "Create all audience versions"   → blog adapt <file> --all
  "Show variant status"            → blog adapt-list
  "Publish all variants"           → blog publish-variants <file>
  "Pull variants from Ghost"      → blog pull-variants <file>
  "Backfill Ghost-only posts"     → blog pull-missing
  "Start capturing"                → capture start <name>
  "Save that exchange"             → capture save <user> <assistant>
  "What have we captured?"         → capture list
  "Export captures for blog"       → capture export

⚠️  FABRIC SAFETY NOTE:
  Always use 'blog improve' instead of running fabric directly on blog files.
  Direct fabric usage can inject metadata (Author/Published/Series) that
  shouldn't be in source files. The improve command sanitizes output automatically.

Examples:
  content-cli pm create "Database Connection Leak" --severity HIGH
  content-cli pm promote PM-007
  content-cli blog add ~/my-post.md
  content-cli blog list --drafts
  content-cli blog rate blog-post-8-bulletproof-observability.md
  content-cli blog rate --all-drafts
  content-cli blog rate --published --pattern rate_content
  content-cli blog improve blog-post-8.md --dry-run
  content-cli blog improve blog-post-8.md --yes
  content-cli blog status
  content-cli blog adapt blog-post-29-five-bugs.md --all --dry-run
  content-cli blog adapt blog-post-29-five-bugs.md --audience aspiring
  content-cli blog adapt-list
  content-cli blog publish-variants blog-post-29-five-bugs.md
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
          console.error("Usage: content-cli pm promote <PM-NNN> [--skip-verify]");
          process.exit(1);
        }
        const skipVerify = args.includes("--skip-verify");
        await pmPromote(pmNumber, skipVerify);
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
        const allPublished = target === "--published" || args.includes("--published");

        if (!target && !allDrafts && !allPublished) {
          console.error("Usage: content-cli blog rate <file> | --all-drafts | --published [--pattern rate_blog_post|rate_content]");
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

        // Determine mode
        let mode: RateMode = "single";
        if (allDrafts) mode = "drafts";
        else if (allPublished) mode = "published";

        await blogRate(mode === "single" ? target : "", mode, pattern);
      } else if (subcommand === "status") {
        await blogStatus();
      } else if (subcommand === "improve") {
        const target = args[2];
        if (!target) {
          console.error("Usage: content-cli blog improve <file> [--dry-run] [--yes] [--pattern <name>]");
          process.exit(1);
        }

        const options: ImproveOptions = {
          dryRun: args.includes("--dry-run"),
          noConfirm: args.includes("--yes"),
        };

        // Parse --pattern flag
        const patternIdx = args.indexOf("--pattern");
        if (patternIdx !== -1 && args[patternIdx + 1]) {
          options.pattern = args[patternIdx + 1];
        }

        await blogImprove(target, options);
      } else if (subcommand === "verify") {
        const target = args[2];
        if (!target) {
          console.error("Usage: content-cli blog verify <file> [--verbose]");
          process.exit(1);
        }
        const verbose = args.includes("--verbose");
        await blogVerify(target, { verbose });
      } else if (subcommand === "adapt") {
        const target = args[2];
        if (!target) {
          console.error("Usage: content-cli blog adapt <file> --audience aspiring|general | --all [--force] [--dry-run]");
          process.exit(1);
        }

        const audienceIdx = args.indexOf("--audience");
        let audience: AudienceKey | undefined;
        if (audienceIdx !== -1 && args[audienceIdx + 1]) {
          const a = args[audienceIdx + 1] as AudienceKey;
          if (a in AUDIENCES) {
            audience = a;
          } else {
            console.error(`Unknown audience: ${a}. Use: aspiring, general`);
            process.exit(1);
          }
        }

        const adaptOptions: AdaptOptions = {
          audience,
          all: args.includes("--all"),
          force: args.includes("--force"),
          dryRun: args.includes("--dry-run"),
        };

        await blogAdapt(target, adaptOptions);
      } else if (subcommand === "adapt-list") {
        blogAdaptList();
      } else if (subcommand === "publish-variants") {
        const target = args[2];
        if (!target) {
          console.error("Usage: content-cli blog publish-variants <file>");
          process.exit(1);
        }
        await blogPublishVariants(target);
      } else if (subcommand === "pull-variants") {
        const target = args[2];
        if (!target) {
          console.error("Usage: content-cli blog pull-variants <file>");
          process.exit(1);
        }
        await blogPullVariants(target);
      } else if (subcommand === "pull-missing") {
        await blogPullMissing();
      } else {
        console.error(`Unknown blog subcommand: ${subcommand}`);
        process.exit(1);
      }
    } else if (command === "capture") {
      if (subcommand === "start") {
        const name = args[2];
        if (!name) {
          console.error("Usage: content-cli capture start <name> [--context \"...\"]");
          process.exit(1);
        }
        const contextIdx = args.indexOf("--context");
        const context = contextIdx !== -1 ? args[contextIdx + 1] : undefined;
        await captureStart(name, context);
      } else if (subcommand === "save") {
        const userContent = args[2];
        const assistantContent = args[3];
        if (!userContent || !assistantContent) {
          console.error("Usage: content-cli capture save <user-content> <assistant-content> [--note \"...\"]");
          process.exit(1);
        }
        const noteIdx = args.indexOf("--note");
        const note = noteIdx !== -1 ? args[noteIdx + 1] : undefined;
        await captureSave(userContent, assistantContent, note);
      } else if (subcommand === "suggest") {
        const userContent = args[2];
        const assistantContent = args[3];
        if (!userContent || !assistantContent) {
          console.error("Usage: content-cli capture suggest <user-content> <assistant-content> [--pattern \"...\"]");
          process.exit(1);
        }
        const patternIdx = args.indexOf("--pattern");
        const pattern = patternIdx !== -1 ? args[patternIdx + 1] : undefined;
        await captureSuggest(userContent, assistantContent, pattern);
      } else if (subcommand === "list") {
        captureList();
      } else if (subcommand === "review") {
        const action = args[2];
        const captureId = args[3];
        await captureReview(action, captureId);
      } else if (subcommand === "export") {
        const format = args.includes("--json") ? "json" : undefined;
        captureExport(format);
      } else if (subcommand === "clear") {
        captureClear();
      } else {
        console.error(`Unknown capture subcommand: ${subcommand}`);
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
