/**
 * tier-publisher.ts — Ghost API integration for tiered content publishing
 *
 * Reads tier files (free.md, starter.md, pro.md) from a directory,
 * resolves credentials from k8s, and creates Ghost drafts with
 * appropriate visibility settings.
 */

import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { marked } from "marked";

// ============================================================================
// Constants
// ============================================================================

const K8S_SERVER = "https://192.168.7.53:6443";
const GHOST_URL = "https://blog.escape-velocity-ventures.org";

const TIER_VISIBILITY: Record<string, string> = {
  free: "public",
  starter: "members",
  pro: "paid",
};

const TIER_ORDER = ["free", "starter", "pro"] as const;

// ============================================================================
// Types
// ============================================================================

export interface PublishOptions {
  tierDir: string;
  ghostPostId?: string;
  dryRun: boolean;
}

export interface TierPublishResult {
  tier: string;
  title: string;
  visibility: string;
  postId?: string;
  /** Link to Ghost editor (for drafts) */
  editorUrl?: string;
  skipped?: boolean;
}

interface GhostCredentials {
  adminKey: string;
  cfClientId: string;
  cfClientSecret: string;
}

// ============================================================================
// Credential resolution
// ============================================================================

function getK8sSecretField(secretName: string, namespace: string, jsonpath: string): string {
  const base64 = execSync(
    `kubectl --server="${K8S_SERVER}" get secret ${secretName} -n ${namespace} -o jsonpath='${jsonpath}'`,
    { encoding: "utf8" }
  ).trim();
  if (!base64) {
    throw new Error(`k8s secret ${secretName}/${jsonpath} returned empty value`);
  }
  return Buffer.from(base64, "base64").toString("utf8").trim();
}

function resolveCredentials(): GhostCredentials {
  const adminKey = getK8sSecretField("ghost-admin-api", "infrastructure", "{.data.key}");
  const cfClientId = getK8sSecretField("cloudflare-ghost-access-token", "infrastructure", "{.data.client-id}");
  const cfClientSecret = getK8sSecretField("cloudflare-ghost-access-token", "infrastructure", "{.data.client-secret}");
  return { adminKey, cfClientId, cfClientSecret };
}

// ============================================================================
// JWT generation
// ============================================================================

function generateJWT(adminKey: string): string {
  const [keyId, keySecret] = adminKey.split(":");
  if (!keyId || !keySecret) {
    throw new Error("Invalid Ghost Admin API key format — expected <id>:<secret>");
  }

  const key = Buffer.from(keySecret, "hex");
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: keyId })
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", key)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

// ============================================================================
// Content processing
// ============================================================================

interface ProcessedContent {
  title: string;
  html: string;
}

function processMarkdown(rawContent: string): ProcessedContent {
  let md = rawContent;

  // Strip YAML frontmatter block (--- ... ---)
  md = md.replace(/^---\n[\s\S]*?\n---\n*/m, "");

  // Extract title from first H1
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Untitled";

  // Strip first H1 line (the title)
  md = md.replace(/^#[^\n]+\n+/, "");

  // Strip leading italic subtitle (e.g. *Subtitle text here*)
  md = md.replace(/^\*[^\n]+\*\n+/, "");

  // Strip leading horizontal rule
  md = md.replace(/^---\n+/, "");

  const html = marked(md.trim()) as string;
  return { title, html };
}

// ============================================================================
// Ghost API
// ============================================================================

async function updateGhostDraft(
  credentials: GhostCredentials,
  jwt: string,
  postId: string,
  payload: {
    title: string;
    html: string;
    visibility: string;
    tags: Array<{ name: string }>;
  }
): Promise<{ id: string; title: string }> {
  // Ghost requires updated_at to guard against conflicts — fetch current value first
  const fetchRes = await fetch(
    `${GHOST_URL}/ghost/api/admin/posts/${postId}/?fields=updated_at`,
    {
      headers: {
        Authorization: `Ghost ${jwt}`,
        "CF-Access-Client-Id": credentials.cfClientId,
        "CF-Access-Client-Secret": credentials.cfClientSecret,
      },
    }
  );

  if (!fetchRes.ok) {
    const text = await fetchRes.text();
    throw new Error(`Ghost API fetch error (${fetchRes.status}): ${text.slice(0, 500)}`);
  }

  const fetchData = (await fetchRes.json()) as { posts: Array<{ updated_at: string }> };
  const updatedAt = fetchData.posts[0]?.updated_at;

  const body = JSON.stringify({
    posts: [
      {
        title: payload.title,
        html: payload.html,
        status: "draft",
        visibility: payload.visibility,
        tags: payload.tags,
        updated_at: updatedAt,
      },
    ],
  });

  const response = await fetch(
    `${GHOST_URL}/ghost/api/admin/posts/${postId}/?source=html`,
    {
      method: "PUT",
      headers: {
        Authorization: `Ghost ${jwt}`,
        "CF-Access-Client-Id": credentials.cfClientId,
        "CF-Access-Client-Secret": credentials.cfClientSecret,
        "Content-Type": "application/json",
      },
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ghost API update error (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as { posts: Array<{ id: string; title: string }> };
  return data.posts[0];
}

async function createGhostDraft(
  credentials: GhostCredentials,
  jwt: string,
  payload: {
    title: string;
    html: string;
    visibility: string;
    tags: Array<{ name: string }>;
  }
): Promise<{ id: string; title: string }> {
  const body = JSON.stringify({
    posts: [
      {
        title: payload.title,
        html: payload.html,
        status: "draft",
        visibility: payload.visibility,
        tags: payload.tags,
      },
    ],
  });

  const response = await fetch(`${GHOST_URL}/ghost/api/admin/posts/?source=html`, {
    method: "POST",
    headers: {
      Authorization: `Ghost ${jwt}`,
      "CF-Access-Client-Id": credentials.cfClientId,
      "CF-Access-Client-Secret": credentials.cfClientSecret,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Ghost API error (${response.status}): ${text.slice(0, 500)}`
    );
  }

  const data = (await response.json()) as { posts: Array<{ id: string; title: string }> };
  return data.posts[0];
}

// ============================================================================
// Main publish entry point
// ============================================================================

export async function publishTiers(options: PublishOptions): Promise<TierPublishResult[]> {
  const { tierDir, ghostPostId, dryRun } = options;

  // Resolve credentials (skip in dry-run to allow testing without cluster)
  let credentials: GhostCredentials | null = null;
  let jwt = "";

  if (!dryRun) {
    credentials = resolveCredentials();
    jwt = generateJWT(credentials.adminKey);
  }

  const results: TierPublishResult[] = [];

  for (const tier of TIER_ORDER) {
    const filePath = path.join(tierDir, `${tier}.md`);

    if (!fs.existsSync(filePath)) {
      results.push({
        tier,
        title: "(not found)",
        visibility: TIER_VISIBILITY[tier],
        skipped: true,
      });
      continue;
    }

    const rawContent = fs.readFileSync(filePath, "utf8");
    const { title, html } = processMarkdown(rawContent);
    const visibility = TIER_VISIBILITY[tier];

    const tags: Array<{ name: string }> = [
      { name: tier },
      ...(ghostPostId ? [{ name: `source:${ghostPostId}` }] : []),
    ];

    if (dryRun) {
      results.push({
        tier,
        title,
        visibility,
        skipped: false,
      });
      continue;
    }

    // Create the draft in Ghost
    const post = await createGhostDraft(credentials!, jwt, {
      title,
      html,
      visibility,
      tags,
    });

    results.push({
      tier,
      title: post.title,
      visibility,
      postId: post.id,
      editorUrl: `${GHOST_URL}/ghost/#/editor/post/${post.id}`,
    });
  }

  return results;
}

// ============================================================================
// Update entry point (sync command)
// ============================================================================

export interface UpdateOptions {
  tierDir: string;
  /** Map of tier → Ghost post ID to update */
  ghostIds: Partial<Record<string, string>>;
  dryRun: boolean;
}

export async function updateTiers(options: UpdateOptions): Promise<TierPublishResult[]> {
  const { tierDir, ghostIds, dryRun } = options;

  let credentials: GhostCredentials | null = null;
  let jwt = "";

  if (!dryRun) {
    credentials = resolveCredentials();
    jwt = generateJWT(credentials.adminKey);
  }

  const results: TierPublishResult[] = [];

  for (const tier of TIER_ORDER) {
    const postId = ghostIds[tier];
    if (!postId) {
      // No Ghost ID for this tier — skip
      results.push({
        tier,
        title: "(no Ghost ID)",
        visibility: TIER_VISIBILITY[tier],
        skipped: true,
      });
      continue;
    }

    const filePath = path.join(tierDir, `${tier}.md`);
    if (!fs.existsSync(filePath)) {
      results.push({
        tier,
        title: "(file not found)",
        visibility: TIER_VISIBILITY[tier],
        skipped: true,
      });
      continue;
    }

    const rawContent = fs.readFileSync(filePath, "utf8");
    const { title, html } = processMarkdown(rawContent);
    const visibility = TIER_VISIBILITY[tier];

    if (dryRun) {
      results.push({
        tier,
        title,
        visibility,
        postId,
        editorUrl: `${GHOST_URL}/ghost/#/editor/post/${postId}`,
        skipped: false,
      });
      continue;
    }

    const post = await updateGhostDraft(credentials!, jwt, postId, {
      title,
      html,
      visibility,
      tags: [{ name: tier }],
    });

    results.push({
      tier,
      title: post.title,
      visibility,
      postId: post.id,
      editorUrl: `${GHOST_URL}/ghost/#/editor/post/${post.id}`,
    });
  }

  return results;
}
