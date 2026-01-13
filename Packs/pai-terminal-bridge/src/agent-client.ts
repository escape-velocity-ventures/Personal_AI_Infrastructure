/**
 * Agent Client
 *
 * WebSocket client that connects to PAI Agent Service
 * and streams responses back to the terminal.
 */

import WebSocket from 'ws';
import type { AgentMessage, AgentRequest } from './types';

export interface AgentClientOptions {
  url: string;
  onMessage: (msg: AgentMessage) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  reconnect?: boolean;
  reconnectInterval?: number;
}

export class AgentClient {
  private ws: WebSocket | null = null;
  private options: AgentClientOptions;
  private reconnectTimer: Timer | null = null;
  private connected = false;
  private sessionId?: string;

  constructor(options: AgentClientOptions) {
    this.options = {
      reconnect: true,
      reconnectInterval: 5000,
      ...options,
    };
  }

  /**
   * Connect to agent service
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url);

        this.ws.on('open', () => {
          this.connected = true;
          console.log('Connected to PAI Agent');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString()) as AgentMessage;

            // Track session ID
            if (msg.sessionId) {
              this.sessionId = msg.sessionId;
            }

            this.options.onMessage(msg);
          } catch (err) {
            console.error('Failed to parse agent message:', err);
          }
        });

        this.ws.on('error', (err) => {
          this.options.onError(err);
          if (!this.connected) {
            reject(err);
          }
        });

        this.ws.on('close', () => {
          this.connected = false;
          this.options.onClose();

          // Attempt reconnection
          if (this.options.reconnect) {
            this.scheduleReconnect();
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Send a query to the agent
   */
  send(prompt: string, effort: 'quick' | 'standard' | 'determined' = 'standard'): void {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected to agent');
    }

    const request: AgentRequest = {
      type: 'query',
      sessionId: this.sessionId,
      prompt,
      effort,
    };

    this.ws.send(JSON.stringify(request));
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from agent
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.options.reconnect = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log('Attempting to reconnect to PAI Agent...');

      try {
        await this.connect();
      } catch (err) {
        console.error('Reconnection failed:', err);
        this.scheduleReconnect();
      }
    }, this.options.reconnectInterval);
  }
}
