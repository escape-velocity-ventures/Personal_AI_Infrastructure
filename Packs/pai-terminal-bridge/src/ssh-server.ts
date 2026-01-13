/**
 * SSH Server
 *
 * Provides SSH access for Wispr Flow to connect.
 * Each connection gets a PTY that forwards to PAI Agent.
 */

import { Server, type Connection, type Session } from 'ssh2';
import { readFileSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AgentClient } from './agent-client';
import { TerminalRenderer } from './renderer';
import type { BridgeConfig, TerminalSession, AgentMessage } from './types';

export class SSHBridgeServer {
  private server: Server;
  private config: BridgeConfig;
  private sessions = new Map<string, TerminalSession>();

  constructor(config: BridgeConfig) {
    this.config = config;

    // Load host key
    if (!existsSync(config.hostKeyPath)) {
      throw new Error(
        `Host key not found at ${config.hostKeyPath}. Run: bun run generate-keys`
      );
    }

    const hostKey = readFileSync(config.hostKeyPath);

    this.server = new Server(
      {
        hostKeys: [hostKey],
      },
      this.handleConnection.bind(this)
    );
  }

  /**
   * Start the SSH server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.sshPort, '0.0.0.0', () => {
        console.log(`SSH Bridge listening on port ${this.config.sshPort}`);
        console.log(`Connect with: ssh -p ${this.config.sshPort} pai@localhost`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the SSH server
   */
  stop(): void {
    this.server.close();
    this.sessions.clear();
  }

  /**
   * Handle new SSH connection
   */
  private handleConnection(client: Connection): void {
    const sessionId = uuidv4();
    let username = 'anonymous';

    console.log(`New SSH connection: ${sessionId}`);

    client.on('authentication', (ctx) => {
      username = ctx.username;

      // Check allowed users
      if (
        this.config.allowedUsers.length > 0 &&
        !this.config.allowedUsers.includes(username)
      ) {
        ctx.reject(['publickey', 'password']);
        return;
      }

      // Accept all authentication methods for simplicity
      // In production, implement proper auth
      ctx.accept();
    });

    client.on('ready', () => {
      console.log(`Client authenticated: ${username}`);

      // Create session record
      const session: TerminalSession = {
        id: sessionId,
        username,
        connectedAt: new Date(),
        lastActivity: new Date(),
      };
      this.sessions.set(sessionId, session);

      client.on('session', (accept) => {
        const sshSession = accept();
        this.handleSession(sshSession, session);
      });
    });

    client.on('close', () => {
      console.log(`Connection closed: ${sessionId}`);
      this.sessions.delete(sessionId);
    });

    client.on('error', (err) => {
      console.error(`Connection error (${sessionId}):`, err.message);
    });
  }

  /**
   * Handle SSH session (PTY)
   */
  private handleSession(sshSession: Session, termSession: TerminalSession): void {
    let stream: any = null;
    let agentClient: AgentClient | null = null;
    const renderer = new TerminalRenderer();
    let inputBuffer = '';
    let isProcessing = false;

    sshSession.on('pty', (accept, reject, info) => {
      // Accept PTY request
      accept?.();
    });

    sshSession.on('shell', (accept, reject) => {
      stream = accept();

      // Initialize agent client
      agentClient = new AgentClient({
        url: this.config.agentUrl,
        onMessage: (msg: AgentMessage) => {
          // Track agent session ID
          if (msg.sessionId && !termSession.agentSessionId) {
            termSession.agentSessionId = msg.sessionId;
          }

          // Render and send to terminal
          const output = renderer.render(msg);
          if (output) {
            stream.write(output);
          }

          // Show prompt after completion or error
          if (msg.type === 'complete' || msg.type === 'error') {
            isProcessing = false;
            stream.write(renderer.getPrompt());
          }
        },
        onError: (err) => {
          stream.write(`\r\n\x1b[31mAgent error: ${err.message}\x1b[0m\r\n`);
          stream.write(renderer.getPrompt());
          isProcessing = false;
        },
        onClose: () => {
          if (stream) {
            stream.write(renderer.getDisconnected());
          }
        },
      });

      // Connect to agent
      agentClient
        .connect()
        .then(() => {
          // Show welcome message
          stream.write(renderer.getWelcome(termSession.agentSessionId));
          stream.write(renderer.getPrompt());
        })
        .catch((err) => {
          stream.write(
            `\r\n\x1b[31mFailed to connect to PAI Agent: ${err.message}\x1b[0m\r\n`
          );
          stream.write(
            `\x1b[33mMake sure the agent is running at ${this.config.agentUrl}\x1b[0m\r\n`
          );
        });

      // Handle input
      stream.on('data', (data: Buffer) => {
        const input = data.toString();
        termSession.lastActivity = new Date();

        for (const char of input) {
          // Handle special characters
          if (char === '\x03') {
            // Ctrl+C
            if (isProcessing) {
              stream.write('\r\n\x1b[33mInterrupted\x1b[0m\r\n');
              isProcessing = false;
              stream.write(renderer.getPrompt());
            } else {
              stream.write('\r\n');
              stream.close();
            }
            inputBuffer = '';
            continue;
          }

          if (char === '\x04') {
            // Ctrl+D (EOF)
            stream.write('\r\nGoodbye!\r\n');
            stream.close();
            continue;
          }

          if (char === '\x7f' || char === '\b') {
            // Backspace
            if (inputBuffer.length > 0) {
              inputBuffer = inputBuffer.slice(0, -1);
              stream.write('\b \b');
            }
            continue;
          }

          if (char === '\r' || char === '\n') {
            // Enter
            stream.write('\r\n');

            const prompt = inputBuffer.trim();
            inputBuffer = '';

            if (prompt) {
              if (prompt.toLowerCase() === 'exit' || prompt.toLowerCase() === 'quit') {
                stream.write('Goodbye!\r\n');
                stream.close();
                continue;
              }

              if (prompt.toLowerCase() === 'clear') {
                stream.write(renderer.getClearScreen());
                stream.write(renderer.getPrompt());
                continue;
              }

              if (prompt.toLowerCase() === 'help') {
                stream.write(this.getHelp());
                stream.write(renderer.getPrompt());
                continue;
              }

              // Send to agent
              if (agentClient?.isConnected()) {
                isProcessing = true;
                try {
                  agentClient.send(prompt);
                } catch (err) {
                  stream.write(`\r\n\x1b[31mError: ${err}\x1b[0m\r\n`);
                  stream.write(renderer.getPrompt());
                  isProcessing = false;
                }
              } else {
                stream.write('\x1b[31mNot connected to agent\x1b[0m\r\n');
                stream.write(renderer.getPrompt());
              }
            } else {
              stream.write(renderer.getPrompt());
            }
            continue;
          }

          // Regular character - echo and buffer
          if (!isProcessing) {
            inputBuffer += char;
            stream.write(char);
          }
        }
      });

      stream.on('close', () => {
        console.log(`Shell closed for session: ${termSession.id}`);
        agentClient?.disconnect();
      });
    });
  }

  /**
   * Get help text
   */
  private getHelp(): string {
    return `
\x1b[1mPAI Terminal Bridge Commands:\x1b[0m

  \x1b[36mhelp\x1b[0m     Show this help message
  \x1b[36mclear\x1b[0m    Clear the screen
  \x1b[36mexit\x1b[0m     Disconnect from the bridge

\x1b[1mUsage:\x1b[0m

  Just type your message and press Enter.
  Aurelia will respond with streaming text.
  Tools will be called automatically when needed.

\x1b[1mKeyboard Shortcuts:\x1b[0m

  \x1b[36mCtrl+C\x1b[0m   Interrupt current query / Exit
  \x1b[36mCtrl+D\x1b[0m   Disconnect

`;
  }

  /**
   * Get active session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}
