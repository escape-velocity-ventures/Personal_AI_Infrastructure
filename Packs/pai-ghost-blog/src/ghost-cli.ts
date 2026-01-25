#!/usr/bin/env bun
/**
 * Ghost Blog CLI - Unified management tool
 *
 * Usage:
 *   ghost-cli list [--drafts|--published|--all]
 *   ghost-cli get <id|slug>
 *   ghost-cli create --file <markdown> [--title "Title"] [--publish]
 *   ghost-cli update <id|slug> --file <markdown>
 *   ghost-cli delete <id|slug> [--force]
 *   ghost-cli publish <id|slug>
 *   ghost-cli unpublish <id|slug>
 *
 * Environment:
 *   GHOST_URL - Ghost instance URL
 *   GHOST_ADMIN_KEY - Admin API key (id:secret format)
 *
 * Credentials loaded from 1Password if not set:
 *   op://Escape Velocity Ventures Inc./Ghost Admin Key/password
 */

import { readFileSync, existsSync } from "fs";
import { createHmac } from "crypto";
import { marked } from "marked";
import { execSync } from "child_process";

// =============================================================================
// Configuration
// =============================================================================

const GHOST_URL =
  process.env.GHOST_URL || "https://blog.escape-velocity-ventures.org";

function getAdminKey(): string {
  if (process.env.GHOST_ADMIN_KEY) {
    return process.env.GHOST_ADMIN_KEY;
  }

  // Try 1Password
  try {
    const key = execSync(
      'op read "op://Escape Velocity Ventures Inc./Ghost Admin Key/password"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return key;
  } catch {
    console.error("Error: GHOST_ADMIN_KEY not set and 1Password lookup failed");
    console.error(
      "Set GHOST_ADMIN_KEY or ensure 1Password CLI is authenticated"
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

async function apiGet(path: string, token: string): Promise<any> {
  const response = await fetch(`${GHOST_URL}/ghost/api/admin/${path}`, {
    headers: { Authorization: `Ghost ${token}` },
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
    headers: {
      Authorization: `Ghost ${token}`,
      "Content-Type": "application/json",
    },
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
    headers: {
      Authorization: `Ghost ${token}`,
      "Content-Type": "application/json",
    },
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
    headers: { Authorization: `Ghost ${token}` },
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

interface Post {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "scheduled";
  published_at: string | null;
  updated_at: string;
  url: string;
  html?: string;
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
    // Fall back to ID
    const result = await apiGet(`posts/${idOrSlug}/?formats=html`, token);
    return result.posts[0];
  }
}

async function createPost(
  title: string,
  html: string,
  publish: boolean
): Promise<Post> {
  const token = generateToken(getAdminKey());

  const result = await apiPost("posts/?source=html", token, {
    posts: [
      {
        title,
        html,
        status: publish ? "published" : "draft",
      },
    ],
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
      ? "✓ published"
      : post.status === "draft"
        ? "○ draft"
        : "◐ scheduled";
  const date = formatDate(post.published_at || post.updated_at);
  const title =
    post.title.length > 50 ? post.title.slice(0, 47) + "..." : post.title;

  return `${post.id.slice(0, 8)}  ${status.padEnd(12)}  ${date.padEnd(12)}  ${title}`;
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

  console.log(`\n  ID        Status        Date          Title`);
  console.log(`  ${"─".repeat(70)}`);

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

  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error("Usage: ghost-cli create --file <markdown> [--title] [--publish]");
    process.exit(1);
  }

  const filePath = args[fileIdx + 1];
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = readFileSync(filePath, "utf-8");
  const html = markdownToHtml(markdown);

  let title = titleIdx !== -1 ? args[titleIdx + 1] : extractTitle(markdown);
  if (!title) {
    console.error("Error: No title found. Use --title or include # Title in markdown.");
    process.exit(1);
  }

  console.log(`Creating post: "${title}"`);
  console.log(`Status: ${publish ? "published" : "draft"}`);

  const post = await createPost(title, html, publish);

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
  const html = markdownToHtml(markdown);

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

function showHelp(): void {
  console.log(`
Ghost Blog CLI - Unified management tool

Usage:
  ghost-cli <command> [options]

Commands:
  list [--drafts|--published]     List posts (default: all)
  get <id|slug>                   Get post details
  create --file <md> [--publish]  Create post from markdown
  update <id|slug> --file <md>    Update post content
  delete <id|slug> [--force]      Delete a post
  publish <id|slug>               Publish a draft
  unpublish <id|slug>             Revert to draft

Examples:
  ghost-cli list --drafts
  ghost-cli get the-fabrication-test
  ghost-cli create --file ~/post.md --title "My Post"
  ghost-cli delete abc123 --force
  ghost-cli publish the-fabrication-test

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
