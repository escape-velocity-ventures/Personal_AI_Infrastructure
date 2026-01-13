/**
 * PAI Agent WebSocket Server
 *
 * Handles incoming requests from Terminal Bridge and other clients.
 * Supports both WebSocket and HTTP endpoints.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { ModelRouter } from 'pai-llm-provider';
import { AgentRuntime } from './agent-runtime';
import { SessionManager } from './session-manager';
import { ToolExecutor } from './tool-executor';
import type { AgentConfig, AgentRequest, AgentResponse } from './types';

const DEFAULT_CONFIG: AgentConfig = {
  port: 8080,
  defaultEffort: 'standard',
  maxTurns: 10,
  systemPrompt: `You are Aurelia, a helpful AI assistant running in a Kubernetes cluster.

## Available Tools

### System Tools
- bash: Execute shell commands
- read_file: Read file contents
- write_file: Write content to files
- list_files: List directory contents

### Apple Ecosystem (when available)
- apple_calendar_*: Calendar operations (list, today, week, events, search, create)
- apple_reminders_*: Reminders operations (lists, all, today, overdue, search, create, complete)
- apple_contacts_*: Contacts operations (groups, search, get, group, birthdays)
- apple_notes_*: Notes operations (folders, list, get, search, create)

## Guidelines
- Be concise and helpful
- When using tools, briefly explain what you're doing
- For Apple tools, check availability first
- Handle errors gracefully and suggest alternatives`,
};

export class AgentServer {
  private wss: WebSocketServer | null = null;
  private httpServer: ReturnType<typeof Bun.serve> | null = null;
  private runtime: AgentRuntime;
  private config: AgentConfig;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    const llm = ModelRouter.fromEnv();
    const sessions = new SessionManager();
    const tools = new ToolExecutor();

    this.runtime = new AgentRuntime({
      llm,
      sessionManager: sessions,
      toolExecutor: tools,
      config: this.config,
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const port = this.config.port;

    // Health check before starting
    const healthy = await this.runtime.healthCheck();
    if (!healthy) {
      console.warn('Warning: LLM provider health check failed');
    }

    // Create HTTP server with Bun
    const server = this;
    this.httpServer = Bun.serve({
      port,
      fetch: async (req, bunServer) => {
        const url = new URL(req.url);

        // Handle WebSocket upgrade
        const upgradeHeader = req.headers.get('Upgrade');
        if (upgradeHeader?.toLowerCase() === 'websocket') {
          const success = bunServer.upgrade(req, {
            data: { runtime: server.runtime },
          });
          if (success) {
            return undefined; // Upgrade successful
          }
          return new Response('WebSocket upgrade failed', { status: 500 });
        }

        // Health endpoint
        if (url.pathname === '/health') {
          const healthy = await server.runtime.healthCheck();
          return Response.json({ status: healthy ? 'ok' : 'degraded' });
        }

        // Query endpoint (non-streaming)
        if (url.pathname === '/query' && req.method === 'POST') {
          try {
            const body = (await req.json()) as AgentRequest;
            const result = await server.runtime.querySync(
              body.prompt,
              body.sessionId,
              body.effort
            );
            return Response.json(result);
          } catch (error) {
            return Response.json(
              { error: String(error) },
              { status: 500 }
            );
          }
        }

        // Stream endpoint (SSE)
        if (url.pathname === '/stream' && req.method === 'POST') {
          const body = (await req.json()) as AgentRequest;

          return new Response(
            new ReadableStream({
              async start(controller) {
                const encoder = new TextEncoder();

                try {
                  for await (const msg of server.runtime.query(
                    body.prompt,
                    body.sessionId,
                    body.effort
                  )) {
                    const data = `data: ${JSON.stringify(msg)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                  }
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                } catch (error) {
                  const errorMsg = `data: ${JSON.stringify({
                    type: 'error',
                    error: String(error),
                  })}\n\n`;
                  controller.enqueue(encoder.encode(errorMsg));
                } finally {
                  controller.close();
                }
              },
            }),
            {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            }
          );
        }

        return new Response('Not Found', { status: 404 });
      },
      websocket: {
        open: (ws) => {
          console.log('WebSocket client connected');
        },
        message: async (ws, message) => {
          await server.handleWebSocketMessage(ws, message);
        },
        close: (ws) => {
          console.log('WebSocket client disconnected');
        },
      },
    });

    console.log(`PAI Agent Server listening on port ${port}`);
    console.log(`  HTTP:      http://localhost:${port}`);
    console.log(`  WebSocket: ws://localhost:${port}`);
    console.log(`  Health:    http://localhost:${port}/health`);
  }

  /**
   * Handle WebSocket message
   */
  private async handleWebSocketMessage(
    ws: any,
    message: string | Buffer
  ): Promise<void> {
    try {
      const messageStr = typeof message === 'string' ? message : message.toString();
      console.log('WebSocket message received:', messageStr.slice(0, 100));

      const data = JSON.parse(messageStr) as AgentRequest;

      if (data.type !== 'query') {
        ws.send(JSON.stringify({ type: 'error', error: 'Unknown request type' }));
        return;
      }

      console.log('Processing query:', data.prompt?.slice(0, 50));

      // Stream responses back
      for await (const response of this.runtime.query(
        data.prompt,
        data.sessionId,
        data.effort
      )) {
        ws.send(JSON.stringify(response));
      }
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    this.httpServer?.stop();
    this.wss?.close();
    console.log('Server stopped');
  }

  /**
   * Get the runtime (for testing)
   */
  getRuntime(): AgentRuntime {
    return this.runtime;
  }
}

// CLI entry point
if (import.meta.main) {
  const server = new AgentServer({
    port: parseInt(process.env.PORT || '8080'),
    defaultEffort: (process.env.DEFAULT_EFFORT || 'standard') as any,
  });

  server.start().catch(console.error);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });
}
