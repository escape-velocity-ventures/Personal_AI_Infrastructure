export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type DecayClass = 'standard' | 'ephemeral' | 'long-term';
export type Visibility = 'shared' | 'private';
export type Outcome = 'success' | 'error' | 'blocked' | 'unknown';
export type TenantType = 'personal' | 'organization';
export type TenantRole = 'owner' | 'admin' | 'member' | 'reader';
export type Scope = 'personal' | 'org' | 'team';

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
  tenantId?: string;
  authorId?: string;
  scope?: Scope;
  tenantType?: string;
  tenantSlug?: string;
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
  tenantId?: string;
  scope?: Scope;
}

export interface UpdateMemoryOptions {
  content?: string;
  tags?: string[];
  sourcePath?: string;
  sourceType?: string;
  memoryType?: MemoryType;
  visibility?: Visibility;
  decayClass?: DecayClass;
  expiresAt?: Date | null;
  scope?: Scope;
}

export interface SearchOptions {
  limit?: number;
  memoryType?: MemoryType;
  tags?: string[];
  agentId?: string;           // default: all shared
  minSimilarity?: number;
  mode?: 'vector' | 'fts' | 'hybrid';
  tenantIds?: string[];
  scopes?: Scope[];
  userId?: string;
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
  tenantId?: string;
  authorId?: string;
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
  userId?: string;
  tenantIds?: string[];
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

export interface Tenant {
  id: string;
  slug: string;
  type: TenantType;
  name: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  handle: string;
  email?: string;
  defaultTenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMember {
  tenantId: string;
  userId: string;
  role: TenantRole;
  joinedAt: Date;
}

export interface TenantContext {
  userId: string;
  tenantIds: string[];
  activeTenantId?: string;
}

export interface CreateTenantOptions {
  slug: string;
  type: TenantType;
  name: string;
  settings?: Record<string, unknown>;
}

export interface AddMemberOptions {
  tenantId: string;
  userId: string;
  role: TenantRole;
}

export interface PromoteOptions {
  chunkId: string;
  fromTenantId: string;
  toTenantId: string;
}

// Source types
export type SourceType = 'git_repo' | 'local_path' | 'upload' | 'claude_memory';
export type AuthType = 'pat' | 'ssh_key' | 'deploy_key';
export type GitProvider = 'github' | 'gitea' | 'gitlab';
export type SyncSchedule = 'manual' | 'hourly' | 'daily' | 'weekly';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type ChunkStrategy = 'heading' | 'paragraph' | 'fixed_size';

export interface MemorySource {
  id: string;
  tenant_id: string;
  name: string;
  source_type: SourceType;
  repo_url?: string;
  branch: string;
  base_path: string;
  include_globs: string[];
  exclude_globs: string[];
  credential_id?: string;
  sync_schedule: SyncSchedule;
  sync_enabled: boolean;
  chunk_strategy: ChunkStrategy;
  default_tags: string[];
  last_sync_at?: string;
  last_sync_hash?: string;
  last_sync_stats: Record<string, number>;
  sync_status: SyncStatus;
  sync_error?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface SourceCredential {
  id: string;
  tenant_id: string;
  name: string;
  auth_type: AuthType;
  provider?: GitProvider;
  encrypted_value: string;
  encrypted_iv: string;
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
  created_by?: string;
}

export interface SourceFileState {
  source_id: string;
  file_path: string;
  content_hash: string;
  last_synced: string;
  chunk_ids: string[];
}

export interface CreateSourceOptions {
  tenant_id: string;
  name: string;
  source_type: SourceType;
  repo_url?: string;
  branch?: string;
  base_path?: string;
  include_globs?: string[];
  exclude_globs?: string[];
  credential_id?: string;
  sync_schedule?: SyncSchedule;
  chunk_strategy?: ChunkStrategy;
  default_tags?: string[];
  created_by?: string;
}

export interface UpdateSourceOptions {
  name?: string;
  branch?: string;
  base_path?: string;
  include_globs?: string[];
  exclude_globs?: string[];
  credential_id?: string;
  sync_schedule?: SyncSchedule;
  sync_enabled?: boolean;
  chunk_strategy?: ChunkStrategy;
  default_tags?: string[];
}

export interface CreateCredentialOptions {
  tenant_id: string;
  name: string;
  auth_type: AuthType;
  provider?: GitProvider;
  value: string;  // plaintext — will be encrypted before storage
  expires_at?: string;
  created_by?: string;
}

export interface ExportFilter {
  tenant_ids?: string[];
  tags?: string[];
  source_ids?: string[];
  entity_names?: string[];
  memory_types?: MemoryType[];
  date_from?: string;
  date_to?: string;
  scopes?: Scope[];
  include_embeddings?: boolean;
}

export interface ImportOptions {
  tenant_id: string;
  source_name?: string;
  default_tags?: string[];
  chunk_strategy?: ChunkStrategy;
  author_id?: string;
  scope?: Scope;
}

export interface SyncStats {
  files_scanned: number;
  files_changed: number;
  files_added: number;
  files_deleted: number;
  chunks_created: number;
  chunks_deleted: number;
  duration_ms: number;
}
