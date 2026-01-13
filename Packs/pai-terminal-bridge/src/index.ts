/**
 * PAI Terminal Bridge
 *
 * SSH-based terminal bridge for Wispr Flow to PAI Agent communication.
 *
 * @example
 * ```bash
 * # Generate SSH host keys first
 * bun run generate-keys
 *
 * # Start the bridge
 * PAI_AGENT_URL=ws://localhost:8080 bun run start
 *
 * # Connect with SSH
 * ssh -p 2222 pai@localhost
 * ```
 */

import { join } from 'path';
import { SSHBridgeServer } from './ssh-server';
import type { BridgeConfig } from './types';

// Types
export type { BridgeConfig, TerminalSession, AgentMessage, AgentRequest } from './types';

// Components
export { SSHBridgeServer } from './ssh-server';
export { AgentClient } from './agent-client';
export { TerminalRenderer } from './renderer';

// Default configuration
const DEFAULT_CONFIG: BridgeConfig = {
  sshPort: parseInt(process.env.SSH_PORT || '2222'),
  agentUrl: process.env.PAI_AGENT_URL || 'ws://localhost:8080',
  hostKeyPath: process.env.HOST_KEY_PATH || join(import.meta.dir, '..', 'keys', 'host_key'),
  allowedUsers: (process.env.ALLOWED_USERS || '').split(',').filter(Boolean),
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '3600000'), // 1 hour
};

// CLI entry point
if (import.meta.main) {
  console.log('╭─────────────────────────────────────╮');
  console.log('│  PAI Terminal Bridge                │');
  console.log('╰─────────────────────────────────────╯');
  console.log('');
  console.log('Configuration:');
  console.log(`  SSH Port:    ${DEFAULT_CONFIG.sshPort}`);
  console.log(`  Agent URL:   ${DEFAULT_CONFIG.agentUrl}`);
  console.log(`  Host Key:    ${DEFAULT_CONFIG.hostKeyPath}`);
  console.log(`  Allowed:     ${DEFAULT_CONFIG.allowedUsers.length || 'all'} users`);
  console.log('');

  const server = new SSHBridgeServer(DEFAULT_CONFIG);

  server
    .start()
    .then(() => {
      console.log('');
      console.log('Ready for connections!');
    })
    .catch((err) => {
      console.error('Failed to start server:', err.message);

      if (err.message.includes('Host key not found')) {
        console.log('\nRun: bun run generate-keys');
      }

      process.exit(1);
    });

  // Handle shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
