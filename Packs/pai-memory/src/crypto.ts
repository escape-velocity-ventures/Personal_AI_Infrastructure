/**
 * AES-256-GCM encryption/decryption for credential storage.
 *
 * Encrypts sensitive data (tokens, API keys) at rest using an
 * environment-provided 256-bit key. No key rotation, no KMS —
 * just straightforward authenticated encryption.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ─── Key Management ─────────────────────────────────────────────────────────

/** Resolve the 256-bit encryption key from ENGRAM_ENCRYPTION_KEY env var. */
function getKey(): Buffer {
  const key = process.env.ENGRAM_ENCRYPTION_KEY;
  if (!key) throw new Error('ENGRAM_ENCRYPTION_KEY is required for credential encryption');
  if (key.length !== 64) throw new Error('ENGRAM_ENCRYPTION_KEY must be 64 hex characters (256 bits)');
  return Buffer.from(key, 'hex');
}

// ─── Encrypt / Decrypt ──────────────────────────────────────────────────────

/** Encrypt a plaintext string with AES-256-GCM. Returns base64-encoded ciphertext+authTag and IV. */
export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Append auth tag to encrypted data
  const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), authTag]).toString('base64');

  return {
    encrypted: combined,
    iv: iv.toString('base64'),
  };
}

/** Decrypt AES-256-GCM ciphertext. Expects base64-encoded data with appended auth tag. */
export function decrypt(encryptedData: string, ivBase64: string): string {
  const key = getKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const combined = Buffer.from(encryptedData, 'base64');

  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ─── Key Generation ─────────────────────────────────────────────────────────

/** Generate a random 256-bit hex key suitable for ENGRAM_ENCRYPTION_KEY. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}
