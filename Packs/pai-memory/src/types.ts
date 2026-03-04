export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type DecayClass = 'standard' | 'ephemeral' | 'long-term';
export type Visibility = 'shared' | 'private';
export type Outcome = 'success' | 'error' | 'blocked' | 'unknown';

export interface MemoryChunk {
  id: string;
  content: string;
  sourcePath?: string;
  sourceType: string;
  memoryType: MemoryType;
  tags: string[];
  agentId: string;
  visibility: Visibility;
  decayClass: DecayClass;
  expiresAt?: Date;
  sessionId?: string;
  createdAt: Date;
  similarity?: number;
}

export interface WriteMemoryOptions {
  memoryType?: MemoryType;
  tags?: string[];
  sourcePath?: string;
  sourceType?: string;
  visibility?: Visibility;
  decayClass?: DecayClass;
  expiresAt?: Date;
  sessionId?: string;
}

export interface SearchOptions {
  limit?: number;
  memoryType?: MemoryType;
  tags?: string[];
  agentId?: string;           // default: all shared
  minSimilarity?: number;
  mode?: 'vector' | 'fts' | 'hybrid';
}

export interface Entity {
  id: string;
  name: string;
  entityType: string;
  summary?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommandEntry {
  agentId?: string;
  sessionId: string;
  machineId?: string;
  projectPath?: string;
  gitBranch?: string;
  ts: Date | string;
  toolName: string;
  commandText: string;
  description?: string;
  userPrompt?: string;
  reasoning?: string;
  outcome?: Outcome;
  resultText?: string;
  exitCode?: number;
}

export interface PatternResult {
  toolName: string;
  commandText: string;
  count: number;
  lastRun: Date;
  avgDurationMs?: number;
  errorRate: number;
}

export interface MemoryClientConfig {
  pgUrl: string;
  redisUrl: string;
  ollamaUrl?: string;          // default: http://localhost:11434
  embeddingModel?: string;     // default: nomic-embed-text
  agentId?: string;            // default: 'main'
  bootstrapTtlSeconds?: number; // default: 300
  /** Called after every embed() call. durationSec covers full call including cache check. cached=true means Redis hit, no Ollama call was made. */
  onEmbed?: (durationSec: number, success: boolean, cached: boolean) => void;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}
