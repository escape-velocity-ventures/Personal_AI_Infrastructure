/**
 * PAI K8s Agent Types
 */

import type { ChatMessage, Tool, EffortLevel } from 'pai-llm-provider';

export interface AgentConfig {
  /** Redis URL for state/queue */
  redisUrl?: string;
  /** WebSocket server port */
  port: number;
  /** Default effort level */
  defaultEffort: EffortLevel;
  /** Maximum turns before stopping */
  maxTurns: number;
  /** System prompt for the agent */
  systemPrompt: string;
}

export interface SessionState {
  id: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface AgentRequest {
  type: 'query';
  sessionId?: string;
  prompt: string;
  effort?: EffortLevel;
  tools?: string[];
}

export interface AgentResponse {
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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'grpc' | 'http';
  command?: string;
  args?: string[];
  endpoint?: string;
}

export interface AgentTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    id: string;
    result: unknown;
  }>;
}
