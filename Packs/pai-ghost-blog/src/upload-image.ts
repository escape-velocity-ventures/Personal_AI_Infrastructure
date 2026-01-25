#!/usr/bin/env bun
/**
 * Upload a single image to Ghost
 * Usage: bun run upload-image.ts <image-path> [target-filename]
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { createHmac } from 'crypto';

// Load .env from PAI root
const PAI_ROOT = dirname(dirname(dirname(import.meta.path)));
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

const GHOST_URL = process.env.GHOST_URL || 'http://localhost:2368';
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

async function uploadImage(imagePath: string, targetName?: string): Promise<string> {
  if (!GHOST_ADMIN_KEY) {
    throw new Error('GHOST_ADMIN_KEY environment variable required');
  }

  const token = generateToken(GHOST_ADMIN_KEY);
  const url = `${GHOST_URL}/ghost/api/admin/images/upload/`;
  const imageData = readFileSync(imagePath);
  const filename = targetName || basename(imagePath);
  const mimeType = getMimeType(filename);

  const formData = new FormData();
  formData.append('file', new Blob([imageData], { type: mimeType }), filename);
  formData.append('purpose', 'image');
  formData.append('ref', filename);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Ghost ${token}` },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.images[0].url;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: bun run upload-image.ts <image-path> [target-filename]');
  process.exit(1);
}

const imagePath = args[0];
const targetName = args[1];

if (!existsSync(imagePath)) {
  console.error(`File not found: ${imagePath}`);
  process.exit(1);
}

console.log(`Uploading: ${imagePath}`);
if (targetName) console.log(`As: ${targetName}`);

try {
  const url = await uploadImage(imagePath, targetName);
  console.log(`\n✅ Uploaded successfully!`);
  console.log(`   URL: ${url}`);
} catch (error) {
  console.error(`\n❌ Error: ${error}`);
  process.exit(1);
}
