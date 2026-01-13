/**
 * PAI Terminal Bridge Types
 */

export interface BridgeConfig {
  /** SSH server port */
  sshPort: number;
  /** PAI Agent WebSocket URL */
  agentUrl: string;
  /** Host key path */
  hostKeyPath: string;
  /** Allowed users (empty = allow all) */
  allowedUsers: string[];
  /** Session timeout in ms */
  sessionTimeout: number;
}

export interface TerminalSession {
  id: string;
  username: string;
  agentSessionId?: string;
  connectedAt: Date;
  lastActivity: Date;
}

export interface AgentMessage {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  sessionId: string;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  toolResult?: {
    id: string;
    result: unknown;
  };
  error?: string;
}

export interface AgentRequest {
  type: 'query';
  sessionId?: string;
  prompt: string;
  effort?: 'quick' | 'standard' | 'determined';
}
