#!/usr/bin/env bun
/**
 * Update an existing Ghost post
 * Usage: bun run update-post.ts --slug <slug> --add-image <image-url> --after <text>
 */

import { createHmac } from 'crypto';

// Load .env from PAI repository
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function loadPaiEnv(): void {
  const paiRepo = process.env.PAI_REPO || join(homedir(), 'EscapeVelocity/PersonalAI/PAI');
  const envPath = join(paiRepo, '.env');
  if (!existsSync(envPath)) return;
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) process.env[key] = value;
    }
  }
}
loadPaiEnv();

const GHOST_URL = process.env.GHOST_URL || 'https://blog.escape-velocity-ventures.org';
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

function cfHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    h['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
    h['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  }
  return h;
}

function generateToken(key: string): string {
  const [id, secret] = key.split(':');
  const header = { alg: 'HS256', typ: 'JWT', kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, aud: '/admin/' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secretBuffer = Buffer.from(secret, 'hex');
  const signature = createHmac('sha256', secretBuffer).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

async function getPostBySlug(slug: string): Promise<any> {
  const token = generateToken(GHOST_ADMIN_KEY);
  const url = `${GHOST_URL}/ghost/api/admin/posts/slug/${slug}/?formats=html,lexical`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Ghost ${token}`, ...cfHeaders() }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Get post error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.posts[0];
}

async function updatePost(id: string, updatedAt: string, html: string): Promise<any> {
  const token = generateToken(GHOST_ADMIN_KEY);
  const url = `${GHOST_URL}/ghost/api/admin/posts/${id}/?source=html`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Ghost ${token}`,
      'Content-Type': 'application/json',
      ...cfHeaders()
    },
    body: JSON.stringify({
      posts: [{
        html: html,
        updated_at: updatedAt
      }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Update post error: ${response.status} - ${error}`);
  }

  return response.json();
}

// CLI
const args = process.argv.slice(2);
const slugIndex = args.indexOf('--slug');
const imageUrlIndex = args.indexOf('--add-image');
const afterIndex = args.indexOf('--after');

if (slugIndex === -1) {
  console.log('Usage: bun run update-post.ts --slug <slug> --add-image <image-url> --after "text to find"');
  process.exit(1);
}

const slug = args[slugIndex + 1];
const imageUrl = imageUrlIndex !== -1 ? args[imageUrlIndex + 1] : null;
const afterText = afterIndex !== -1 ? args[afterIndex + 1] : null;

console.log(`Fetching post: ${slug}`);
const post = await getPostBySlug(slug);
console.log(`Found post: ${post.title} (ID: ${post.id})`);

let html = post.html;

if (imageUrl && afterText) {
  // Find the text and insert image after the paragraph containing it
  const searchText = afterText.toLowerCase();

  // Create the image HTML
  const imageHtml = `<figure class="kg-card kg-image-card kg-width-wide"><img src="${imageUrl}" class="kg-image" alt="Terminal Bridge Architecture" loading="lazy"></figure>`;

  // Find paragraph containing the search text
  const regex = new RegExp(`(<p>[^<]*${afterText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</p>)`, 'i');

  if (regex.test(html)) {
    html = html.replace(regex, `$1\n${imageHtml}`);
    console.log(`Inserted image after: "${afterText}"`);
  } else {
    // Try finding heading
    const headingRegex = new RegExp(`(<h[23][^>]*>[^<]*${afterText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</h[23]>)`, 'i');
    if (headingRegex.test(html)) {
      html = html.replace(headingRegex, `$1\n${imageHtml}`);
      console.log(`Inserted image after heading: "${afterText}"`);
    } else {
      console.log(`Could not find: "${afterText}"`);
      console.log('HTML preview:', html.substring(0, 500));
      process.exit(1);
    }
  }
}

console.log('Updating post...');
const result = await updatePost(post.id, post.updated_at, html);
console.log(`\n✅ Post updated successfully!`);
console.log(`   URL: ${GHOST_URL}/${slug}/`);
