/**
 * PAI State Service Types
 *
 * Defines interfaces for distributed state management.
 */

export interface StateConfig {
  redis?: {
    url: string;
    prefix?: string;
  };
  postgres?: {
    connectionString: string;
  };
}

/**
 * Session data stored in state service
 */
export interface SessionData {
  id: string;
  messages: MessageData[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageData {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCallData[];
  timestamp: Date;
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Real-time state (Redis)
 */
export interface RealtimeState {
  /** Current active session ID */
  activeSession?: string;
  /** Agent status */
  status: 'idle' | 'processing' | 'error';
  /** Current task description */
  currentTask?: string;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Custom state data */
  data: Record<string, unknown>;
}

/**
 * Event for observability
 */
export interface StateEvent {
  id: string;
  type: string;
  sessionId?: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

/**
 * Memory entry (replaces file-based MEMORY system)
 */
export interface MemoryEntry {
  id: string;
  type: 'session_summary' | 'fact' | 'preference' | 'context';
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Metrics data (for TELOS integration)
 */
export interface MetricEntry {
  id: string;
  kpiId: string;
  value: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
