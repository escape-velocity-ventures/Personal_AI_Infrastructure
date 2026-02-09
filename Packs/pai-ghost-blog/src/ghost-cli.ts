#!/usr/bin/env bun
/**
 * Ghost Blog CLI - Unified management tool
 *
 * Usage:
 *   ghost-cli list [--drafts|--published|--all]
 *   ghost-cli get <id|slug>
 *   ghost-cli create --file <markdown> [--title "Title"] [--publish] [--tags tag1,tag2]
 *   ghost-cli update <id|slug> --file <markdown>
 *   ghost-cli delete <id|slug> [--force]
 *   ghost-cli publish <id|slug>
 *   ghost-cli unpublish <id|slug>
 *   ghost-cli upload <image-path> [--name <filename>]
 *   ghost-cli set-image <id|slug> --url <image-url>
 *   ghost-cli set-image <id|slug> --file <image-path>
 *   ghost-cli pull <id|slug> [--file <output.md>]
 *   ghost-cli search-tag <tag-slug>
 *
 * Environment:
 *   GHOST_URL - Ghost instance URL
 *   GHOST_ADMIN_KEY - Admin API key (id:secret format)
 *
 * Credentials loaded from 1Password if not set:
 *   op://Escape Velocity Ventures Inc./Ghost Admin Key/password
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { basename } from "path";
import { createHmac } from "crypto";
import { marked } from "marked";
import TurndownService from "turndown";
import { execSync } from "child_process";

// =============================================================================
// Configuration
// =============================================================================

const GHOST_URL =
  process.env.GHOST_URL || "https://blog.escape-velocity-ventures.org";

// Cloudflare Access credentials (for bypassing Zero Trust protection on /ghost/*)
interface CloudflareAccessCreds {
  clientId: string;
  clientSecret: string;
}

function getCloudflareAccessCreds(): CloudflareAccessCreds | null {
  // 1. Check environment variables
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    return {
      clientId: process.env.CF_ACCESS_CLIENT_ID,
      clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    };
  }

  // 2. Try Kubernetes secret
  try {
    const clientId = execSync(
      "kubectl get secret cloudflare-ghost-access-token -n infrastructure -o jsonpath='{.data.client-id}' 2>/dev/null | base64 -d",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    const clientSecret = execSync(
      "kubectl get secret cloudflare-ghost-access-token -n infrastructure -o jsonpath='{.data.client-secret}' 2>/dev/null | base64 -d",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
  } catch {
    // Fall through - CF Access may not be configured
  }

  return null;
}

function getAdminKey(): string {
  // 1. Check environment variable
  if (process.env.GHOST_ADMIN_KEY) {
    return process.env.GHOST_ADMIN_KEY;
  }

  // 2. Try Kubernetes secret (preferred for cluster operations)
  try {
    const key = execSync(
      'kubectl get secret ghost-admin-api -n infrastructure -o jsonpath=\'{.data.key}\' 2>/dev/null | base64 -d',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (key && key.includes(":")) {
      return key;
    }
  } catch {
    // Fall through to 1Password
  }

  // 3. Fall back to 1Password
  try {
    const key = execSync(
      'op read "op://Escape Velocity Ventures Inc./Ghost Admin Key/password"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return key;
  } catch {
    console.error("Error: GHOST_ADMIN_KEY not set and lookup failed");
    console.error(
      "Tried: env var, k8s secret (infrastructure/ghost-admin-api), 1Password"
    );
    process.exit(1);
  }
}

// =============================================================================
// Auth
// =============================================================================

function generateToken(key: string): string {
  const [id, secret] = key.split(":");
  if (!id || !secret) {
    console.error("Error: Invalid GHOST_ADMIN_KEY format. Expected id:secret");
    process.exit(1);
  }

  const header = { alg: "HS256", typ: "JWT", kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, aud: "/admin/" };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secretBuffer = Buffer.from(secret, "hex");
  const signature = createHmac("sha256", secretBuffer)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
}

// =============================================================================
// API Helpers
// =============================================================================

// Cache Cloudflare Access credentials for the session
let cfAccessCreds: CloudflareAccessCreds | null | undefined;

function getHeaders(token: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Ghost ${token}`,
  };

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  // Add Cloudflare Access headers if available (for bypassing Zero Trust)
  if (cfAccessCreds === undefined) {
    cfAccessCreds = getCloudflareAccessCreds();
  }

  if (cfAccessCreds) {
    headers["CF-Access-Client-Id"] = cfAccessCreds.clientId;
    headers["CF-Access-Client-Secret"] = cfAccessCreds.clientSecret;
  }

  return headers;
}

async function apiGet(path: string, token: string): Promise<any> {
  const response = await fetch(`${GHOST_URL}/ghost/api/admin/${path}`, {
    headers: getHeaders(token),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response.json();
}

async function apiPost(path: string, token: string, body: any): Promise<any> {
  const response = await fetch(`${GHOST_URL}/ghost/api/admin/${path}`, {
    method: "POST",
    headers: getHeaders(token, "application/json"),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response.json();
}

async function apiPut(path: string, token: string, body: any): Promise<any> {
  const response = await fetch(`${GHOST_URL}/ghost/api/admin/${path}`, {
    method: "PUT",
    headers: getHeaders(token, "application/json"),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response.json();
}

async function apiDelete(path: string, token: string): Promise<boolean> {
  const response = await fetch(`${GHOST_URL}/ghost/api/admin/${path}`, {
    method: "DELETE",
    headers: getHeaders(token),
  });

  if (response.status === 204) {
    return true;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return true;
}

// =============================================================================
// Post Operations
// =============================================================================

interface GhostTag {
  id: string;
  name: string;
  slug: string;
}

interface Post {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "scheduled";
  published_at: string | null;
  updated_at: string;
  url: string;
  html?: string;
  feature_image?: string;
  tags?: GhostTag[];
}

async function listPosts(
  filter: "all" | "drafts" | "published"
): Promise<Post[]> {
  const token = generateToken(getAdminKey());
  let query = "posts/?limit=50&order=updated_at%20desc";

  if (filter === "drafts") {
    query += "&filter=status:draft";
  } else if (filter === "published") {
    query += "&filter=status:published";
  }

  const result = await apiGet(query, token);
  return result.posts;
}

async function getPost(idOrSlug: string): Promise<Post> {
  const token = generateToken(getAdminKey());

  // Try by slug first (more user-friendly)
  try {
    const result = await apiGet(
      `posts/slug/${idOrSlug}/?formats=html`,
      token
    );
    return result.posts[0];
  } catch {
    // Try by full ID
    const result = await apiGet(`posts/${idOrSlug}/?formats=html`, token);
    return result.posts[0];
  }
}

async function createPost(
  title: string,
  html: string,
  publish: boolean,
  tags?: string[]
): Promise<Post> {
  const token = generateToken(getAdminKey());

  const postData: any = {
    title,
    html,
    status: publish ? "published" : "draft",
  };
  if (tags?.length) {
    postData.tags = tags.map(name => ({ name }));
  }

  const result = await apiPost("posts/?source=html", token, {
    posts: [postData],
  });

  return result.posts[0];
}

async function updatePostContent(
  idOrSlug: string,
  html: string
): Promise<Post> {
  const token = generateToken(getAdminKey());
  const post = await getPost(idOrSlug);

  const result = await apiPut(`posts/${post.id}/?source=html`, token, {
    posts: [
      {
        id: post.id,
        html,
        updated_at: post.updated_at,
      },
    ],
  });

  return result.posts[0];
}

async function deletePost(idOrSlug: string): Promise<void> {
  const token = generateToken(getAdminKey());
  const post = await getPost(idOrSlug);
  await apiDelete(`posts/${post.id}/`, token);
}

async function publishPost(idOrSlug: string): Promise<Post> {
  const token = generateToken(getAdminKey());
  const post = await getPost(idOrSlug);

  const result = await apiPut(`posts/${post.id}/`, token, {
    posts: [
      {
        status: "published",
        updated_at: post.updated_at,
      },
    ],
  });

  return result.posts[0];
}

async function unpublishPost(idOrSlug: string): Promise<Post> {
  const token = generateToken(getAdminKey());
  const post = await getPost(idOrSlug);

  const result = await apiPut(`posts/${post.id}/`, token, {
    posts: [
      {
        status: "draft",
        updated_at: post.updated_at,
      },
    ],
  });

  return result.posts[0];
}

async function setFeatureImage(idOrSlug: string, imageUrl: string): Promise<Post> {
  const token = generateToken(getAdminKey());
  const post = await getPost(idOrSlug);

  const result = await apiPut(`posts/${post.id}/`, token, {
    posts: [
      {
        feature_image: imageUrl,
        updated_at: post.updated_at,
      },
    ],
  });

  return result.posts[0];
}

async function searchPostsByTag(tagSlug: string): Promise<Post[]> {
  const token = generateToken(getAdminKey());
  const query = `posts/?filter=tag:${encodeURIComponent(tagSlug)}&include=tags&formats=html&limit=all`;
  const result = await apiGet(query, token);
  return result.posts || [];
}

async function getPostWithTags(idOrSlug: string): Promise<Post> {
  const token = generateToken(getAdminKey());

  try {
    const result = await apiGet(
      `posts/slug/${idOrSlug}/?formats=html&include=tags`,
      token
    );
    return result.posts[0];
  } catch {
    const result = await apiGet(`posts/${idOrSlug}/?formats=html&include=tags`, token);
    return result.posts[0];
  }
}

// =============================================================================
// HTML to Markdown Conversion
// =============================================================================

function htmlToMarkdown(html: string, title?: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // Preserve code block language hints
  turndown.addRule("fencedCodeBlock", {
    filter: (node) => {
      return node.nodeName === "PRE" && !!node.querySelector("code");
    },
    replacement: (_content, node) => {
      const codeEl = (node as HTMLElement).querySelector("code");
      const code = codeEl?.textContent || "";
      const lang = codeEl?.className?.replace("language-", "") || "";
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    },
  });

  let markdown = turndown.turndown(html);

  // Prepend title as H1 if provided
  if (title) {
    markdown = `# ${title}\n\n${markdown}`;
  }

  // Clean up excessive blank lines
  markdown = markdown.replace(/\n{3,}/g, "\n\n");

  // Ensure trailing newline
  if (!markdown.endsWith("\n")) {
    markdown += "\n";
  }

  return markdown;
}

// =============================================================================
// Image Operations
// =============================================================================

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

async function uploadImage(imagePath: string, targetName?: string): Promise<string> {
  const token = generateToken(getAdminKey());
  const url = `${GHOST_URL}/ghost/api/admin/images/upload/`;
  const imageData = readFileSync(imagePath);
  const filename = targetName || basename(imagePath);
  const mimeType = getMimeType(filename);

  const formData = new FormData();
  formData.append("file", new Blob([imageData], { type: mimeType }), filename);
  formData.append("purpose", "image");
  formData.append("ref", filename);

  // Get headers with Cloudflare Access support (but don't set Content-Type for FormData)
  const headers = getHeaders(token);
  // Remove Content-Type if set - let browser set it with boundary for FormData
  delete (headers as any)["Content-Type"];

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.images[0].url;
}

// =============================================================================
// Content Linting
// =============================================================================

interface LintIssue {
  severity: "error" | "warning";
  message: string;
  match?: string;
}

const LINT_PATTERNS = [
  { pattern: /\*\*Status:\*\*.*Draft/i, message: "Contains draft status metadata", severity: "error" as const },
  { pattern: /\*\*Author:\*\*.*\*\*Published:\*\*.*\*\*Series:\*\*/i, message: "Contains Author/Published/Series metadata", severity: "error" as const },
  { pattern: /## Assets\s*\n\s*\|/m, message: "Contains Assets table (draft metadata)", severity: "error" as const },
  { pattern: /Copy assets to final blog/i, message: "Contains 'Copy assets' note", severity: "error" as const },
  { pattern: /Publication Checklist/i, message: "Contains Publication Checklist", severity: "error" as const },
  { pattern: /\[subscribe\s*\/\s*follow/i, message: "Contains placeholder [subscribe / follow]", severity: "error" as const },
  { pattern: /\[repo link\]/i, message: "Contains placeholder [repo link]", severity: "error" as const },
  { pattern: /\[TODO[:\]]?/i, message: "Contains TODO marker", severity: "warning" as const },
  { pattern: /\[TBD[:\]]?/i, message: "Contains TBD marker", severity: "warning" as const },
  { pattern: /\[FIXME[:\]]?/i, message: "Contains FIXME marker", severity: "warning" as const },
  { pattern: /~\/Downloads\//i, message: "Contains ~/Downloads path reference", severity: "warning" as const },
  { pattern: /~\/Desktop\//i, message: "Contains ~/Desktop path reference", severity: "warning" as const },
];

function lintContent(content: string): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const { pattern, message, severity } of LINT_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      issues.push({ severity, message, match: match[0].substring(0, 50) });
    }
  }
  return issues;
}

function printLintResults(issues: LintIssue[], filePath?: string): boolean {
  if (issues.length === 0) {
    console.log(`✅ No issues found${filePath ? ` in ${filePath}` : ""}`);
    return true;
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (filePath) console.log(`\nLinting: ${filePath}`);

  for (const issue of errors) {
    console.log(`  ❌ ERROR: ${issue.message}`);
    if (issue.match) console.log(`     Found: "${issue.match}..."`);
  }
  for (const issue of warnings) {
    console.log(`  ⚠️  WARN: ${issue.message}`);
    if (issue.match) console.log(`     Found: "${issue.match}..."`);
  }

  return errors.length === 0;
}

// =============================================================================
// Markdown Processing
// =============================================================================

function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function markdownToHtml(markdown: string): string {
  // Remove title (first H1) - Ghost handles title separately
  let content = markdown.replace(/^#\s+.+\n/, "");
  // Remove subtitle line if present
  content = content.replace(/^\*[^*]+\*\n/, "");
  return marked(content) as string;
}

/**
 * Extract image references from markdown
 * Returns array of { fullMatch, alt, path, isLocal }
 */
function extractImageReferences(markdown: string): Array<{
  fullMatch: string;
  alt: string;
  path: string;
  isLocal: boolean;
}> {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: Array<{ fullMatch: string; alt: string; path: string; isLocal: boolean }> = [];

  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const [fullMatch, alt, path] = match;
    // Check if it's a URL or local path
    const isLocal = !path.startsWith("http://") &&
                    !path.startsWith("https://") &&
                    !path.startsWith("data:");
    images.push({ fullMatch, alt, path, isLocal });
  }

  return images;
}

/**
 * Process markdown images: upload local images and replace with URLs
 * @param markdown - The markdown content
 * @param basePath - Base directory for resolving relative image paths
 * @returns Modified markdown with uploaded image URLs
 */
async function processMarkdownImages(
  markdown: string,
  basePath: string
): Promise<string> {
  const { dirname, join, isAbsolute } = await import("path");

  const images = extractImageReferences(markdown);
  const localImages = images.filter((img) => img.isLocal);

  if (localImages.length === 0) {
    return markdown;
  }

  console.log(`\n📷 Found ${localImages.length} local image(s) to upload:`);

  let processedMarkdown = markdown;

  for (const img of localImages) {
    // Resolve the image path relative to the markdown file
    const imagePath = isAbsolute(img.path)
      ? img.path
      : join(dirname(basePath), img.path);

    if (!existsSync(imagePath)) {
      console.log(`   ⚠️  Skipping (not found): ${img.path}`);
      continue;
    }

    try {
      console.log(`   ⬆️  Uploading: ${img.path}`);
      const uploadedUrl = await uploadImage(imagePath);
      console.log(`   ✅ Uploaded: ${uploadedUrl}`);

      // Replace the original path with the uploaded URL in markdown
      const newImageRef = `![${img.alt}](${uploadedUrl})`;
      processedMarkdown = processedMarkdown.replace(img.fullMatch, newImageRef);
    } catch (error) {
      console.log(`   ❌ Failed to upload ${img.path}: ${(error as Error).message}`);
    }
  }

  console.log();
  return processedMarkdown;
}

// =============================================================================
// CLI Formatting
// =============================================================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPostRow(post: Post): string {
  const status =
    post.status === "published"
      ? "✓"
      : post.status === "draft"
        ? "○"
        : "◐";
  const date = formatDate(post.published_at || post.updated_at);

  return `${status}  ${post.id}  ${date.padEnd(12)}  ${post.slug}`;
}

// =============================================================================
// Commands
// =============================================================================

async function cmdList(args: string[]): Promise<void> {
  let filter: "all" | "drafts" | "published" = "all";

  if (args.includes("--drafts")) filter = "drafts";
  if (args.includes("--published")) filter = "published";

  const posts = await listPosts(filter);

  if (posts.length === 0) {
    console.log(`No ${filter === "all" ? "" : filter + " "}posts found.`);
    return;
  }

  console.log(`\n     ID                        Date          Slug`);
  console.log(`  ${"─".repeat(90)}`);

  for (const post of posts) {
    console.log(`  ${formatPostRow(post)}`);
  }

  console.log(`\n  Total: ${posts.length} posts\n`);
}

async function cmdGet(args: string[]): Promise<void> {
  const idOrSlug = args[0];
  if (!idOrSlug) {
    console.error("Usage: ghost-cli get <id|slug>");
    process.exit(1);
  }

  const post = await getPost(idOrSlug);

  console.log(`\n  Title:     ${post.title}`);
  console.log(`  ID:        ${post.id}`);
  console.log(`  Slug:      ${post.slug}`);
  console.log(`  Status:    ${post.status}`);
  console.log(`  Published: ${formatDate(post.published_at)}`);
  console.log(`  Updated:   ${formatDate(post.updated_at)}`);
  console.log(`  URL:       ${post.url}`);
  console.log(`  Admin:     ${GHOST_URL}/ghost/#/editor/post/${post.id}`);
  console.log();
}

async function cmdCreate(args: string[]): Promise<void> {
  const fileIdx = args.indexOf("--file");
  const titleIdx = args.indexOf("--title");
  const publish = args.includes("--publish");
  const skipLint = args.includes("--no-lint");
  const tagsIdx = args.indexOf("--tags");
  const tags = tagsIdx !== -1 && args[tagsIdx + 1]
    ? args[tagsIdx + 1].split(",").map(t => t.trim())
    : undefined;

  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error("Usage: ghost-cli create --file <markdown> [--title] [--publish] [--no-lint] [--tags tag1,tag2]");
    process.exit(1);
  }

  const filePath = args[fileIdx + 1];
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = readFileSync(filePath, "utf-8");

  // Lint content before creating
  if (!skipLint) {
    const issues = lintContent(markdown);
    const hasErrors = issues.some((i) => i.severity === "error");
    if (issues.length > 0) {
      console.log("\n⚠️  Content issues detected:");
      printLintResults(issues, filePath);
      if (hasErrors && publish) {
        console.error("\n❌ Cannot publish with errors. Fix issues or use --no-lint to bypass.");
        process.exit(1);
      }
      if (hasErrors) {
        console.log("\n⚠️  Creating as draft due to errors. Fix issues before publishing.");
      }
    }
  }

  // Process inline images - upload local images and replace paths with URLs
  const processedMarkdown = await processMarkdownImages(markdown, filePath);

  const html = markdownToHtml(processedMarkdown);

  let title = titleIdx !== -1 ? args[titleIdx + 1] : extractTitle(markdown);
  if (!title) {
    console.error("Error: No title found. Use --title or include # Title in markdown.");
    process.exit(1);
  }

  console.log(`Creating post: "${title}"`);
  console.log(`Status: ${publish ? "published" : "draft"}`);
  if (tags?.length) {
    console.log(`Tags: ${tags.join(", ")}`);
  }

  const post = await createPost(title, html, publish, tags);

  console.log(`\n✅ Post created successfully!`);
  console.log(`   ID:    ${post.id}`);
  console.log(`   URL:   ${post.url}`);
  console.log(`   Admin: ${GHOST_URL}/ghost/#/editor/post/${post.id}\n`);
}

async function cmdUpdate(args: string[]): Promise<void> {
  const idOrSlug = args[0];
  const fileIdx = args.indexOf("--file");

  if (!idOrSlug || fileIdx === -1 || !args[fileIdx + 1]) {
    console.error("Usage: ghost-cli update <id|slug> --file <markdown>");
    process.exit(1);
  }

  const filePath = args[fileIdx + 1];
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = readFileSync(filePath, "utf-8");

  // Process inline images - upload local images and replace paths with URLs
  const processedMarkdown = await processMarkdownImages(markdown, filePath);

  const html = markdownToHtml(processedMarkdown);

  console.log(`Updating post: ${idOrSlug}`);

  const post = await updatePostContent(idOrSlug, html);

  console.log(`\n✅ Post updated successfully!`);
  console.log(`   Title: ${post.title}`);
  console.log(`   URL:   ${post.url}\n`);
}

async function cmdDelete(args: string[]): Promise<void> {
  const idOrSlug = args[0];
  const force = args.includes("--force");

  if (!idOrSlug) {
    console.error("Usage: ghost-cli delete <id|slug> [--force]");
    process.exit(1);
  }

  // Get post first to show what we're deleting
  const post = await getPost(idOrSlug);

  if (!force) {
    console.log(`\n  About to delete:`);
    console.log(`  Title:  ${post.title}`);
    console.log(`  Status: ${post.status}`);
    console.log(`  ID:     ${post.id}`);
    console.log(`\n  Use --force to confirm deletion.\n`);
    return;
  }

  await deletePost(idOrSlug);

  console.log(`\n✅ Deleted: "${post.title}"\n`);
}

async function cmdPublish(args: string[]): Promise<void> {
  const idOrSlug = args[0];

  if (!idOrSlug) {
    console.error("Usage: ghost-cli publish <id|slug>");
    process.exit(1);
  }

  console.log(`Publishing: ${idOrSlug}`);

  const post = await publishPost(idOrSlug);

  console.log(`\n✅ Published!`);
  console.log(`   Title: ${post.title}`);
  console.log(`   URL:   ${post.url}\n`);
}

async function cmdUnpublish(args: string[]): Promise<void> {
  const idOrSlug = args[0];

  if (!idOrSlug) {
    console.error("Usage: ghost-cli unpublish <id|slug>");
    process.exit(1);
  }

  console.log(`Unpublishing: ${idOrSlug}`);

  const post = await unpublishPost(idOrSlug);

  console.log(`\n✅ Reverted to draft!`);
  console.log(`   Title: ${post.title}\n`);
}

async function cmdUpload(args: string[]): Promise<void> {
  const imagePath = args[0];
  const nameIdx = args.indexOf("--name");
  const targetName = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

  if (!imagePath) {
    console.error("Usage: ghost-cli upload <image-path> [--name <filename>]");
    process.exit(1);
  }

  if (!existsSync(imagePath)) {
    console.error(`Error: File not found: ${imagePath}`);
    process.exit(1);
  }

  console.log(`Uploading: ${imagePath}`);
  if (targetName) console.log(`As: ${targetName}`);

  const url = await uploadImage(imagePath, targetName);

  console.log(`\n✅ Uploaded successfully!`);
  console.log(`   URL: ${url}\n`);
}

async function cmdSetImage(args: string[]): Promise<void> {
  const idOrSlug = args[0];
  const urlIdx = args.indexOf("--url");
  const fileIdx = args.indexOf("--file");

  if (!idOrSlug || (urlIdx === -1 && fileIdx === -1)) {
    console.error("Usage: ghost-cli set-image <id|slug> --url <image-url>");
    console.error("       ghost-cli set-image <id|slug> --file <image-path>");
    process.exit(1);
  }

  let imageUrl: string;

  if (fileIdx !== -1) {
    const imagePath = args[fileIdx + 1];
    if (!existsSync(imagePath)) {
      console.error(`Error: File not found: ${imagePath}`);
      process.exit(1);
    }
    console.log(`Uploading: ${imagePath}`);
    imageUrl = await uploadImage(imagePath);
    console.log(`Uploaded: ${imageUrl}`);
  } else {
    imageUrl = args[urlIdx + 1];
  }

  console.log(`Setting feature image for: ${idOrSlug}`);

  const post = await setFeatureImage(idOrSlug, imageUrl);

  console.log(`\n✅ Feature image set!`);
  console.log(`   Title: ${post.title}`);
  console.log(`   Image: ${imageUrl}\n`);
}

async function cmdLint(args: string[]): Promise<void> {
  const filePath = args[0];

  if (!filePath) {
    console.error("Usage: ghost-cli lint <markdown-file>");
    console.error("       ghost-cli lint --live [--slug <slug>]");
    process.exit(1);
  }

  if (filePath === "--live") {
    // Lint live posts
    const slugIdx = args.indexOf("--slug");
    const specificSlug = slugIdx !== -1 ? args[slugIdx + 1] : null;

    const token = generateToken(getAdminKey());
    const query = specificSlug
      ? `posts/slug/${specificSlug}/?formats=html`
      : "posts/?limit=all&formats=html&filter=status:published";
    const result = await apiGet(query, token);
    const posts = specificSlug ? result.posts : result.posts;

    let allClean = true;
    for (const post of posts) {
      const issues = lintContent(post.html || "");
      if (issues.length > 0) {
        allClean = false;
        console.log(`\n❌ ${post.title} (${post.slug})`);
        printLintResults(issues);
      }
    }

    if (allClean) {
      console.log(`✅ All ${posts.length} published posts are clean!`);
    }
    return;
  }

  // Lint local file
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = readFileSync(filePath, "utf-8");
  const issues = lintContent(markdown);
  const passed = printLintResults(issues, filePath);
  process.exit(passed ? 0 : 1);
}

async function cmdDiff(args: string[]): Promise<void> {
  const slug = args[0];
  const fileIdx = args.indexOf("--file");
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : null;

  if (!slug) {
    console.error("Usage: ghost-cli diff <slug> --file <local-markdown>");
    process.exit(1);
  }

  if (!filePath) {
    console.error("Error: --file <path> is required");
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const token = generateToken(getAdminKey());
  const post = await getPost(slug);

  // Convert local markdown to HTML for comparison
  const localMarkdown = readFileSync(filePath, "utf-8");
  const localHtml = markdownToHtml(localMarkdown);

  // Strip HTML tags for text comparison
  const stripHtml = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const liveText = stripHtml(post.html || "");
  const localText = stripHtml(localHtml);

  if (liveText === localText) {
    console.log(`✅ ${post.title}`);
    console.log("   Live content matches local file (no differences)");
    return;
  }

  console.log(`\n📝 ${post.title}`);
  console.log(`   Slug: ${slug}`);
  console.log(`   Local: ${filePath}`);
  console.log(`\n   ⚠️  Content differs between live and local`);

  // Show character count difference
  const diff = localText.length - liveText.length;
  console.log(`   Live: ${liveText.length} chars | Local: ${localText.length} chars (${diff > 0 ? "+" : ""}${diff})`);

  // Show first difference location
  let firstDiffIdx = 0;
  for (let i = 0; i < Math.min(liveText.length, localText.length); i++) {
    if (liveText[i] !== localText[i]) {
      firstDiffIdx = i;
      break;
    }
  }

  if (firstDiffIdx > 0) {
    const context = 50;
    console.log(`\n   First difference at position ${firstDiffIdx}:`);
    console.log(`   Live:  "...${liveText.substring(Math.max(0, firstDiffIdx - 20), firstDiffIdx + context)}..."`);
    console.log(`   Local: "...${localText.substring(Math.max(0, firstDiffIdx - 20), firstDiffIdx + context)}..."`);
  }
}

// =============================================================================
// Pull Command - Fetch Ghost post and save as local markdown
// =============================================================================

async function cmdPull(args: string[]): Promise<void> {
  const idOrSlug = args[0];
  const fileIdx = args.indexOf("--file");
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : null;

  if (!idOrSlug) {
    console.error("Usage: ghost-cli pull <id|slug> --file <output.md>");
    console.error("       ghost-cli pull <id|slug>  (prints to stdout)");
    process.exit(1);
  }

  const post = await getPostWithTags(idOrSlug);

  if (!post.html) {
    console.error(`\n❌ Post "${post.title}" has no HTML content.\n`);
    process.exit(1);
  }

  const markdown = htmlToMarkdown(post.html, post.title);

  // Show post info
  const tags = post.tags?.map(t => t.name).join(", ") || "none";

  if (filePath) {
    writeFileSync(filePath, markdown);
    console.log(`\n✅ Pulled: "${post.title}"`);
    console.log(`   Slug:   ${post.slug}`);
    console.log(`   Status: ${post.status}`);
    console.log(`   Tags:   ${tags}`);
    console.log(`   Saved:  ${filePath}`);
    console.log(`   Size:   ${markdown.length} chars, ${markdown.split("\n").length} lines\n`);
  } else {
    // Print to stdout for piping
    process.stdout.write(markdown);
  }
}

async function cmdSearchByTag(args: string[]): Promise<Post[]> {
  const tag = args[0];
  if (!tag) {
    console.error("Usage: ghost-cli search-tag <tag-slug>");
    process.exit(1);
  }

  const posts = await searchPostsByTag(tag);

  if (posts.length === 0) {
    console.log(`\nNo posts found with tag: ${tag}\n`);
    return [];
  }

  console.log(`\n  Posts tagged "${tag}" (${posts.length}):\n`);
  for (const post of posts) {
    const status = post.status === "published" ? "✓" : "○";
    const postTags = post.tags?.map(t => t.name).join(", ") || "";
    console.log(`  ${status}  ${post.slug}`);
    console.log(`     "${post.title}"`);
    console.log(`     Tags: ${postTags}\n`);
  }

  return posts;
}

// =============================================================================
// Audit Command - Check posts for image issues
// =============================================================================

interface AuditIssue {
  type: "relative_path" | "double_path" | "feature_relative";
  src: string;
}

async function auditPostImages(post: { title: string; slug: string; html?: string; feature_image?: string }): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  const html = post.html || "";

  // Find all img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (!src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
      issues.push({ type: "relative_path", src });
    } else if (src.includes("content/images/content/images")) {
      issues.push({ type: "double_path", src });
    }
  }

  // Check feature image
  if (post.feature_image && !post.feature_image.startsWith("http")) {
    issues.push({ type: "feature_relative", src: post.feature_image });
  }

  return issues;
}

async function cmdAudit(args: string[]): Promise<void> {
  const token = generateToken(getAdminKey());

  let filter = "all";
  if (args.includes("--drafts")) filter = "drafts";
  if (args.includes("--published")) filter = "published";

  let query = "posts/?limit=all&formats=html";
  if (filter === "drafts") query += "&filter=status:draft";
  if (filter === "published") query += "&filter=status:published";

  const result = await apiGet(query, token);
  const posts = result.posts;

  console.log(`\n  Auditing ${posts.length} ${filter === "all" ? "" : filter + " "}posts for image issues...\n`);

  let postsWithIssues = 0;
  let totalIssues = 0;

  for (const post of posts) {
    const issues = await auditPostImages(post);
    if (issues.length > 0) {
      postsWithIssues++;
      totalIssues += issues.length;
      const status = post.status === "published" ? "✓" : "○";
      console.log(`  ${status} ❌ ${post.title}`);
      console.log(`     Slug: ${post.slug}`);
      for (const issue of issues) {
        const label = issue.type === "relative_path" ? "Relative path" :
                      issue.type === "double_path" ? "Double path" : "Feature image relative";
        console.log(`     - ${label}: ${issue.src}`);
      }
      console.log();
    }
  }

  if (postsWithIssues === 0) {
    console.log(`  ✅ All ${posts.length} posts have valid image URLs!\n`);
  } else {
    console.log(`  ─────────────────────────────────────`);
    console.log(`  Posts with issues: ${postsWithIssues}`);
    console.log(`  Total issues: ${totalIssues}\n`);
  }
}

// =============================================================================
// Sync Command - Compare local files against Ghost
// =============================================================================

interface LocalPost {
  file: string;
  title: string;
  path: string;
}

interface SyncResult {
  local: LocalPost;
  ghost?: { title: string; slug: string; status: string };
}

async function cmdSync(args: string[]): Promise<void> {
  const { readdirSync } = await import("fs");
  const { join, basename } = await import("path");

  // Get directory from args, BLOG_CONTENT_DIR env, or default
  const dirIdx = args.indexOf("--dir");
  const defaultBlogDir = process.env.BLOG_CONTENT_DIR
    ? join(process.env.BLOG_CONTENT_DIR, "blog")
    : join(process.env.HOME || "", ".claude/MEMORY/WORK/blog");
  const blogDir = dirIdx !== -1 && args[dirIdx + 1]
    ? args[dirIdx + 1]
    : defaultBlogDir;

  if (!existsSync(blogDir)) {
    console.error(`Error: Directory not found: ${blogDir}`);
    process.exit(1);
  }

  // Get local markdown files
  const files = readdirSync(blogDir)
    .filter((f: string) => f.startsWith("blog-post-") && f.endsWith(".md") && !f.includes("-metadata"));

  const localPosts: LocalPost[] = [];
  for (const file of files) {
    const filePath = join(blogDir, file);
    const content = readFileSync(filePath, "utf-8");
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      localPosts.push({
        file,
        title: titleMatch[1].trim(),
        path: filePath,
      });
    }
  }

  // Get Ghost posts
  const token = generateToken(getAdminKey());
  const result = await apiGet("posts/?limit=all", token);
  const ghostPosts = result.posts;

  // Normalize title for matching
  const normalize = (t: string) => t.toLowerCase()
    .replace(/^blog post:?\s*/i, "")
    .replace(/^blog post idea:?\s*/i, "")
    .trim();

  // Match local posts to Ghost
  const results: SyncResult[] = [];

  for (const local of localPosts) {
    const localNorm = normalize(local.title);
    let found = null;

    for (const ghost of ghostPosts) {
      const ghostNorm = normalize(ghost.title);
      if (ghostNorm.includes(localNorm.substring(0, 25)) ||
          localNorm.includes(ghostNorm.substring(0, 25))) {
        found = { title: ghost.title, slug: ghost.slug, status: ghost.status };
        break;
      }
    }

    results.push({ local, ghost: found || undefined });
  }

  // Display results
  const synced = results.filter(r => r.ghost);
  const notSynced = results.filter(r => !r.ghost);

  console.log(`\n  Sync Status: ${blogDir}\n`);
  console.log(`  ${"─".repeat(60)}`);

  if (synced.length > 0) {
    console.log(`\n  ✅ SYNCED (${synced.length}):\n`);
    for (const r of synced) {
      const icon = r.ghost!.status === "published" ? "✓" : "○";
      console.log(`     ${icon}  ${r.local.file}`);
    }
  }

  if (notSynced.length > 0) {
    console.log(`\n  ❌ NOT IN GHOST (${notSynced.length}):\n`);
    for (const r of notSynced) {
      console.log(`     -  ${r.local.file}`);
      console.log(`        Title: "${r.local.title}"`);
    }
  }

  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  Local files:     ${localPosts.length}`);
  console.log(`  Synced to Ghost: ${synced.length}`);
  console.log(`  Not synced:      ${notSynced.length}`);
  console.log(`  Ghost total:     ${ghostPosts.length} (${ghostPosts.filter((p: any) => p.status === "published").length} published, ${ghostPosts.filter((p: any) => p.status === "draft").length} drafts)\n`);
}

// =============================================================================
// Bulk Update Command - Update all matching local files
// =============================================================================

async function cmdBulkUpdate(args: string[]): Promise<void> {
  const { readdirSync } = await import("fs");
  const { join } = await import("path");

  // Get directory from args, BLOG_CONTENT_DIR env, or default
  const dirIdx = args.indexOf("--dir");
  const defaultBlogDir = process.env.BLOG_CONTENT_DIR
    ? join(process.env.BLOG_CONTENT_DIR, "blog")
    : join(process.env.HOME || "", ".claude/MEMORY/WORK/blog");
  const blogDir = dirIdx !== -1 && args[dirIdx + 1]
    ? args[dirIdx + 1]
    : defaultBlogDir;

  const dryRun = args.includes("--dry-run");

  if (!existsSync(blogDir)) {
    console.error(`Error: Directory not found: ${blogDir}`);
    process.exit(1);
  }

  // Get local markdown files
  const files = readdirSync(blogDir)
    .filter((f: string) => f.startsWith("blog-post-") && f.endsWith(".md") && !f.includes("-metadata"));

  // Get Ghost posts
  const token = generateToken(getAdminKey());
  const result = await apiGet("posts/?limit=all", token);
  const ghostPosts = result.posts;

  const normalize = (t: string) => t.toLowerCase()
    .replace(/^blog post:?\s*/i, "")
    .replace(/^blog post idea:?\s*/i, "")
    .trim();

  console.log(`\n  Bulk Update: ${blogDir}`);
  if (dryRun) console.log(`  (DRY RUN - no changes will be made)`);
  console.log(`  ${"─".repeat(60)}\n`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const file of files) {
    const filePath = join(blogDir, file);
    const content = readFileSync(filePath, "utf-8");
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (!titleMatch) {
      skipped++;
      continue;
    }

    const localTitle = titleMatch[1].trim();
    const localNorm = normalize(localTitle);

    // Find matching Ghost post
    let ghostPost = null;
    for (const ghost of ghostPosts) {
      const ghostNorm = normalize(ghost.title);
      if (ghostNorm.includes(localNorm.substring(0, 25)) ||
          localNorm.includes(ghostNorm.substring(0, 25))) {
        ghostPost = ghost;
        break;
      }
    }

    if (!ghostPost) {
      console.log(`  ⏭️  ${file} (no matching Ghost post)`);
      notFound++;
      continue;
    }

    const status = ghostPost.status === "published" ? "✓" : "○";

    if (dryRun) {
      console.log(`  ${status} Would update: ${file} → ${ghostPost.slug}`);
      updated++;
    } else {
      try {
        // Process images and convert to HTML
        const processedMarkdown = await processMarkdownImages(content, filePath);
        const html = markdownToHtml(processedMarkdown);

        await updatePostContent(ghostPost.slug, html);
        console.log(`  ${status} ✅ Updated: ${file}`);
        updated++;
      } catch (error) {
        console.log(`  ${status} ❌ Failed: ${file} - ${(error as Error).message}`);
      }
    }
  }

  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Not found: ${notFound}\n`);
}

function showHelp(): void {
  console.log(`
Ghost Blog CLI - Unified management tool

Usage:
  ghost-cli <command> [options]

Commands:
  list [--drafts|--published]     List posts (default: all)
  get <id|slug>                   Get post details
  create --file <md> [--publish] [--tags t1,t2]  Create post from markdown
  update <id|slug> --file <md>    Update post content
  delete <id|slug> [--force]      Delete a post
  publish <id|slug>               Publish a draft
  unpublish <id|slug>             Revert to draft
  upload <image> [--name <name>]  Upload image to Ghost
  set-image <id|slug> --url <url> Set feature image from URL
  set-image <id|slug> --file <path> Upload and set feature image
  lint <file>                     Check markdown for draft metadata
  lint --live [--slug <slug>]     Check published posts for issues
  diff <slug> --file <md>         Compare live post with local file
  audit [--drafts|--published]    Check posts for image issues
  sync [--dir <path>]             Compare local files against Ghost
  bulk-update [--dir <path>] [--dry-run]  Update all matching posts
  pull <id|slug> [--file <path>]  Pull Ghost post as local markdown
  search-tag <tag-slug>           Find posts by Ghost tag

Examples:
  ghost-cli list --drafts
  ghost-cli get the-fabrication-test
  ghost-cli create --file ~/post.md --title "My Post"
  ghost-cli delete abc123 --force
  ghost-cli publish the-fabrication-test
  ghost-cli upload ~/header.png --name custom-name.png
  ghost-cli set-image my-post --file ~/header.png
  ghost-cli lint ~/draft-post.md
  ghost-cli lint --live
  ghost-cli diff my-post --file ~/my-post.md

Environment:
  GHOST_URL        Ghost instance URL (default: blog.escape-velocity-ventures.org)
  GHOST_ADMIN_KEY  Admin API key (auto-loaded from 1Password if not set)
`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case "list":
        await cmdList(commandArgs);
        break;
      case "get":
        await cmdGet(commandArgs);
        break;
      case "create":
        await cmdCreate(commandArgs);
        break;
      case "update":
        await cmdUpdate(commandArgs);
        break;
      case "delete":
        await cmdDelete(commandArgs);
        break;
      case "publish":
        await cmdPublish(commandArgs);
        break;
      case "unpublish":
        await cmdUnpublish(commandArgs);
        break;
      case "upload":
        await cmdUpload(commandArgs);
        break;
      case "set-image":
        await cmdSetImage(commandArgs);
        break;
      case "lint":
        await cmdLint(commandArgs);
        break;
      case "diff":
        await cmdDiff(commandArgs);
        break;
      case "audit":
        await cmdAudit(commandArgs);
        break;
      case "sync":
        await cmdSync(commandArgs);
        break;
      case "bulk-update":
        await cmdBulkUpdate(commandArgs);
        break;
      case "pull":
        await cmdPull(commandArgs);
        break;
      case "search-tag":
        await cmdSearchByTag(commandArgs);
        break;
      default:
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
