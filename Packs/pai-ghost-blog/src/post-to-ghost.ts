#!/usr/bin/env bun
/**
 * Post markdown content to Ghost via Admin API
 *
 * Usage:
 *   bun run post-to-ghost.ts --file <markdown-file> [--publish]
 *   bun run post-to-ghost.ts --title "Title" --content "Content" [--publish]
 *
 * Environment:
 *   GHOST_URL - Ghost instance URL (default: http://localhost:2368)
 *   GHOST_ADMIN_KEY - Admin API key from Ghost settings (format: id:secret)
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { createHmac } from 'crypto';
import { marked } from 'marked';

// Load .env from PAI root
// Path: src/post-to-ghost.ts → pai-ghost-blog → Packs → PAI
const PAI_ROOT = dirname(dirname(dirname(dirname(import.meta.path))));
const envPath = join(PAI_ROOT, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// Configuration
const GHOST_URL = process.env.GHOST_URL || 'http://localhost:2368';
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY || '';

interface PostOptions {
  title: string;
  html: string;
  slug?: string;
  feature_image?: string;
  status?: 'draft' | 'published';
  tags?: string[];
  excerpt?: string;
}

/**
 * Generate JWT token for Ghost Admin API
 */
function generateToken(key: string): string {
  const [id, secret] = key.split(':');

  if (!id || !secret) {
    throw new Error('Invalid GHOST_ADMIN_KEY format. Expected "id:secret"');
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: id
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + 300, // 5 minute expiry
    aud: '/admin/'
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const secretBuffer = Buffer.from(secret, 'hex');
  const signature = createHmac('sha256', secretBuffer)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Convert markdown to HTML using marked library
 */
function markdownToHtml(markdown: string): string {
  // Remove YAML frontmatter if present
  const content = markdown.replace(/^---[\s\S]*?---\n/, '');

  // Use marked for proper markdown conversion
  return marked(content) as string;
}

/**
 * Extract title from markdown (first H1 or filename)
 */
function extractTitle(markdown: string, filename: string): string {
  const match = markdown.match(/^# (.+)$/m);
  if (match) return match[1];
  return basename(filename, '.md').replace(/-/g, ' ');
}

/**
 * Extract excerpt from markdown (first paragraph after title)
 */
function extractExcerpt(markdown: string): string {
  const lines = markdown.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
  return lines[0]?.substring(0, 300) || '';
}

/**
 * Create a post via Ghost Admin API
 */
async function createPost(options: PostOptions): Promise<any> {
  if (!GHOST_ADMIN_KEY) {
    throw new Error('GHOST_ADMIN_KEY environment variable required');
  }

  const token = generateToken(GHOST_ADMIN_KEY);
  // source=html tells Ghost 5.x to convert HTML to Lexical format
  const url = `${GHOST_URL}/ghost/api/admin/posts/?source=html`;

  const postData = {
    posts: [{
      title: options.title,
      html: options.html,
      slug: options.slug,
      feature_image: options.feature_image,
      status: options.status || 'draft',
      tags: options.tags?.map(name => ({ name })),
      custom_excerpt: options.excerpt
    }]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Ghost ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(postData)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ghost API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml'
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Upload an image to Ghost
 */
async function uploadImage(imagePath: string): Promise<string> {
  if (!GHOST_ADMIN_KEY) {
    throw new Error('GHOST_ADMIN_KEY environment variable required');
  }

  const token = generateToken(GHOST_ADMIN_KEY);
  const url = `${GHOST_URL}/ghost/api/admin/images/upload/`;

  const imageData = readFileSync(imagePath);
  const filename = basename(imagePath);
  const mimeType = getMimeType(filename);

  const formData = new FormData();
  formData.append('file', new Blob([imageData], { type: mimeType }), filename);
  formData.append('purpose', 'image');
  formData.append('ref', filename);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Ghost ${token}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Image upload error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.images[0].url;
}

/**
 * Parse a blog post markdown file with metadata
 */
function parseMarkdownFile(filepath: string): {
  title: string;
  html: string;
  excerpt: string;
  featureImage?: string;
  tags?: string[];
} {
  const content = readFileSync(filepath, 'utf-8');

  // Sections to SKIP (metadata, not blog content)
  const skipSections = [
    'Assets',
    'Key Facts',
    'Real Example',
    'Timeline Evidence',
    'Publication Checklist',
    'Outline for'
  ];

  // Sections that ARE blog content
  const contentSections = [
    'Opening Hook',
    'Section 2',
    'Section 3',
    'Section 4',
    'The Scaffolding Philosophy',
    'Building in Public',
    'What\'s Next'
  ];

  let blogContent = '';
  let inContent = false;
  let currentSection = '';

  for (const line of content.split('\n')) {
    // Check if this is a section header
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim();

      // Check if we should skip this section
      const shouldSkip = skipSections.some(skip => currentSection.includes(skip));

      // Check if this is a content section
      const isContent = contentSections.some(sec => currentSection.includes(sec));

      if (shouldSkip) {
        inContent = false;
      } else if (isContent) {
        inContent = true;
        // Clean up the section title for the blog (remove "v6 - Final Draft" etc)
        let cleanTitle = currentSection
          .replace(/\(v\d+.*?\)/g, '')
          .replace(/Section \d+:\s*/g, '')
          .trim();
        blogContent += `## ${cleanTitle}\n`;
        continue; // Don't add the original line
      }
    }

    if (inContent) {
      blogContent += line + '\n';
    }
  }

  // If no sections found, use the whole content
  if (!blogContent.trim()) {
    blogContent = content;
  }

  const title = extractTitle(content, filepath);
  const html = markdownToHtml(blogContent);
  const excerpt = extractExcerpt(blogContent);

  return { title, html, excerpt };
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    console.log(`
Ghost Post Publisher

Usage:
  bun run post-to-ghost.ts --file <markdown-file> [options]
  bun run post-to-ghost.ts --title "Title" --content "Content" [options]

Options:
  --file <path>       Markdown file to publish
  --title <string>    Post title (auto-extracted from markdown if not provided)
  --content <string>  HTML content (if not using --file)
  --image <path>      Feature image to upload
  --publish           Publish immediately (default: draft)
  --tags <tags>       Comma-separated tags
  --help              Show this help

Environment:
  GHOST_URL           Ghost instance URL (default: http://localhost:2368)
  GHOST_ADMIN_KEY     Admin API key (required, format: id:secret)

Example:
  export GHOST_ADMIN_KEY="your-key-id:your-secret"
  bun run post-to-ghost.ts --file ~/blog-post.md --image ~/header.png --publish
`);
    process.exit(0);
  }

  // Parse arguments
  const fileIndex = args.indexOf('--file');
  const titleIndex = args.indexOf('--title');
  const contentIndex = args.indexOf('--content');
  const imageIndex = args.indexOf('--image');
  const tagsIndex = args.indexOf('--tags');
  const shouldPublish = args.includes('--publish');

  let title = '';
  let html = '';
  let excerpt = '';
  let featureImageUrl: string | undefined;

  // Load from file
  if (fileIndex !== -1) {
    const filepath = args[fileIndex + 1];
    if (!existsSync(filepath)) {
      console.error(`File not found: ${filepath}`);
      process.exit(1);
    }
    const parsed = parseMarkdownFile(filepath);
    title = parsed.title;
    html = parsed.html;
    excerpt = parsed.excerpt;
  }

  // Override with explicit title/content
  if (titleIndex !== -1) {
    title = args[titleIndex + 1];
  }
  if (contentIndex !== -1) {
    html = args[contentIndex + 1];
  }

  // Upload feature image
  if (imageIndex !== -1) {
    const imagePath = args[imageIndex + 1];
    if (!existsSync(imagePath)) {
      console.error(`Image not found: ${imagePath}`);
      process.exit(1);
    }
    console.log(`Uploading image: ${imagePath}`);
    featureImageUrl = await uploadImage(imagePath);
    console.log(`Image uploaded: ${featureImageUrl}`);
  }

  // Parse tags
  const tags = tagsIndex !== -1 ? args[tagsIndex + 1].split(',').map(t => t.trim()) : undefined;

  if (!title || !html) {
    console.error('Title and content required. Use --file or --title/--content');
    process.exit(1);
  }

  console.log(`Creating post: "${title}"`);
  console.log(`Status: ${shouldPublish ? 'published' : 'draft'}`);

  try {
    const result = await createPost({
      title,
      html,
      excerpt,
      feature_image: featureImageUrl,
      status: shouldPublish ? 'published' : 'draft',
      tags
    });

    const post = result.posts[0];
    console.log(`\n✅ Post created successfully!`);
    console.log(`   ID: ${post.id}`);
    console.log(`   URL: ${GHOST_URL}/${post.slug}/`);
    console.log(`   Admin: ${GHOST_URL}/ghost/#/editor/post/${post.id}`);
  } catch (error) {
    console.error(`\n❌ Error: ${error}`);
    process.exit(1);
  }
}

main();
