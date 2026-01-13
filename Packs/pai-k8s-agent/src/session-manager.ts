/**
 * Session Manager
 *
 * Manages conversation sessions with persistence.
 * Supports in-memory storage (dev) and Redis (production).
 */

import type { ChatMessage } from 'pai-llm-provider';
import type { SessionState } from './types';
import { v4 as uuidv4 } from 'uuid';

export interface SessionStore {
  get(id: string): Promise<SessionState | null>;
  set(id: string, state: SessionState): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * In-memory session store for development
 */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionState>();

  async get(id: string): Promise<SessionState | null> {
    return this.sessions.get(id) || null;
  }

  async set(id: string, state: SessionState): Promise<void> {
    this.sessions.set(id, state);
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async list(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }
}

/**
 * Redis session store for production
 */
export class RedisSessionStore implements SessionStore {
  private client: any;
  private prefix = 'pai:session:';

  constructor(redisClient: any) {
    this.client = redisClient;
  }

  async get(id: string): Promise<SessionState | null> {
    const data = await this.client.get(this.prefix + id);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  async set(id: string, state: SessionState): Promise<void> {
    await this.client.set(
      this.prefix + id,
      JSON.stringify(state),
      { EX: 86400 * 7 } // 7 day expiry
    );
  }

  async delete(id: string): Promise<void> {
    await this.client.del(this.prefix + id);
  }

  async list(): Promise<string[]> {
    const keys = await this.client.keys(this.prefix + '*');
    return keys.map((k: string) => k.replace(this.prefix, ''));
  }
}

/**
 * Session Manager
 */
export class SessionManager {
  private store: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store || new MemorySessionStore();
  }

  /**
   * Create a new session
   */
  async create(systemPrompt?: string): Promise<SessionState> {
    const id = uuidv4();
    const now = new Date();

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const state: SessionState = {
      id,
      messages,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    await this.store.set(id, state);
    return state;
  }

  /**
   * Get an existing session
   */
  async get(id: string): Promise<SessionState | null> {
    return this.store.get(id);
  }

  /**
   * Get or create a session
   */
  async getOrCreate(id?: string, systemPrompt?: string): Promise<SessionState> {
    if (id) {
      const existing = await this.get(id);
      if (existing) return existing;
    }
    return this.create(systemPrompt);
  }

  /**
   * Add a message to a session
   */
  async addMessage(id: string, message: ChatMessage): Promise<void> {
    const state = await this.store.get(id);
    if (!state) {
      throw new Error(`Session ${id} not found`);
    }

    state.messages.push(message);
    state.updatedAt = new Date();
    await this.store.set(id, state);
  }

  /**
   * Add multiple messages to a session
   */
  async addMessages(id: string, messages: ChatMessage[]): Promise<void> {
    const state = await this.store.get(id);
    if (!state) {
      throw new Error(`Session ${id} not found`);
    }

    state.messages.push(...messages);
    state.updatedAt = new Date();
    await this.store.set(id, state);
  }

  /**
   * Get messages from a session
   */
  async getMessages(id: string): Promise<ChatMessage[]> {
    const state = await this.store.get(id);
    return state?.messages || [];
  }

  /**
   * Update session metadata
   */
  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const state = await this.store.get(id);
    if (!state) {
      throw new Error(`Session ${id} not found`);
    }

    state.metadata = { ...state.metadata, ...metadata };
    state.updatedAt = new Date();
    await this.store.set(id, state);
  }

  /**
   * Delete a session
   */
  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /**
   * List all session IDs
   */
  async list(): Promise<string[]> {
    return this.store.list();
  }

  /**
   * Truncate messages to fit context window
   */
  async truncateToFit(id: string, maxTokens: number): Promise<void> {
    const state = await this.store.get(id);
    if (!state) return;

    // Simple estimation: ~4 chars per token
    const estimateTokens = (msg: ChatMessage) =>
      Math.ceil(msg.content.length / 4);

    let totalTokens = state.messages.reduce(
      (sum, msg) => sum + estimateTokens(msg),
      0
    );

    // Keep system message, remove oldest user/assistant messages
    while (totalTokens > maxTokens && state.messages.length > 1) {
      const firstNonSystem = state.messages.findIndex(
        (m) => m.role !== 'system'
      );
      if (firstNonSystem === -1) break;

      totalTokens -= estimateTokens(state.messages[firstNonSystem]);
      state.messages.splice(firstNonSystem, 1);
    }

    state.updatedAt = new Date();
    await this.store.set(id, state);
  }
}
