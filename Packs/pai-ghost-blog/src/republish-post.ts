#!/usr/bin/env bun
/**
 * Republish a Ghost post with updated content from markdown
 */

import { readFileSync, existsSync } from 'fs';
import { createHmac } from 'crypto';
import { marked } from 'marked';
import { dirname, join } from 'path';

// Load .env from PAI root
const PAI_ROOT = join(dirname(import.meta.path), '..', '..', '..');
const envPath = join(PAI_ROOT, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');
      if (key && value) {
        process.env[key] = value;
      }
    }
  }
}

const GHOST_URL = process.env.GHOST_URL || 'https://blog.escape-velocity-ventures.org';
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY || '';

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
  const url = `${GHOST_URL}/ghost/api/admin/posts/slug/${slug}/`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Ghost ${token}` }
  });
  if (!response.ok) throw new Error(`Get post error: ${response.status}`);
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
      'Content-Type': 'application/json'
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
    throw new Error(`Update error: ${response.status} - ${error}`);
  }
  return response.json();
}

function markdownToHtml(markdown: string): string {
  // Remove title (first H1)
  let content = markdown.replace(/^# .+\n/, '');
  // Remove subtitle line
  content = content.replace(/^\*[^*]+\*\n/, '');
  // Remove header image placeholder
  content = content.replace(/!\[Header\]\([^)]+\)\n?/g, '');
  // Fix image URLs - convert relative to absolute
  content = content.replace(
    /!\[([^\]]*)\]\(([^)]+\.png)\)/g,
    (match, alt, filename) => {
      if (filename.startsWith('http')) return match;
      return `![${alt}](https://blog.escape-velocity-ventures.org/content/images/2026/01/${filename})`;
    }
  );
  return marked(content) as string;
}

// CLI
const slug = process.argv[2];
const markdownPath = process.argv[3];

if (!slug || !markdownPath) {
  console.log('Usage: bun run republish-post.ts <slug> <markdown-file>');
  process.exit(1);
}

console.log(`Reading: ${markdownPath}`);
const markdown = readFileSync(markdownPath, 'utf-8');
const html = markdownToHtml(markdown);

console.log(`Fetching post: ${slug}`);
const post = await getPostBySlug(slug);
console.log(`Found: ${post.title} (ID: ${post.id})`);
console.log(`Current HTML length: ${post.html?.length || 0}`);
console.log(`New HTML length: ${html.length}`);

console.log('\nUpdating post...');
await updatePost(post.id, post.updated_at, html);
console.log(`\n✅ Post republished!`);
console.log(`   URL: ${GHOST_URL}/${slug}/`);
