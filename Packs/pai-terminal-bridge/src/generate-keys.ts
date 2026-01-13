/**
 * Generate SSH Host Keys
 *
 * Creates RSA key pair for SSH server using ssh-keygen for maximum compatibility.
 * Run: bun run generate-keys
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const KEY_DIR = join(import.meta.dir, '..', 'keys');
const PRIVATE_KEY_PATH = join(KEY_DIR, 'host_key');
const PUBLIC_KEY_PATH = join(KEY_DIR, 'host_key.pub');

async function main() {
  console.log('Generating SSH host keys...\n');

  // Create keys directory
  if (!existsSync(KEY_DIR)) {
    mkdirSync(KEY_DIR, { recursive: true });
  }

  // Check if keys already exist
  if (existsSync(PRIVATE_KEY_PATH)) {
    console.log('Keys already exist at:');
    console.log(`  Private: ${PRIVATE_KEY_PATH}`);
    console.log(`  Public:  ${PUBLIC_KEY_PATH}`);
    console.log('\nTo regenerate, delete the existing keys first.');
    return;
  }

  // Generate RSA key pair using ssh-keygen for maximum compatibility
  try {
    execSync(
      `ssh-keygen -t rsa -b 4096 -f "${PRIVATE_KEY_PATH}" -N "" -q`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('Failed to generate keys with ssh-keygen:', error);
    process.exit(1);
  }

  console.log('Generated SSH host keys:');
  console.log(`  Private: ${PRIVATE_KEY_PATH}`);
  console.log(`  Public:  ${PUBLIC_KEY_PATH}`);
  console.log('\nAdd the private key path to your configuration.');
}

main().catch(console.error);
