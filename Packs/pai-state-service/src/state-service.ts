/**
 * Unified State Service
 *
 * Combines Redis (real-time) and PostgreSQL (persistent) for
 * comprehensive state management.
 *
 * Strategy:
 * - Redis: Session cache, realtime state, pub/sub, request queue
 * - PostgreSQL: Session persistence, memory, events, metrics
 */

import { v4 as uuidv4 } from 'uuid';
import { RedisStateClient } from './redis-client';
import { PostgresStateClient } from './postgres-client';
import type {
  StateConfig,
  SessionData,
  MessageData,
  RealtimeState,
  StateEvent,
  MemoryEntry,
  MetricEntry,
} from './types';

export class StateService {
  private redis?: RedisStateClient;
  private postgres?: PostgresStateClient;
  private memoryFallback = new Map<string, SessionData>();

  constructor(config: StateConfig) {
    if (config.redis) {
      this.redis = new RedisStateClient(config.redis.url, config.redis.prefix);
    }
    if (config.postgres) {
      this.postgres = new PostgresStateClient(config.postgres.connectionString);
    }
  }

  /**
   * Initialize connections
   */
  async connect(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.redis) {
      promises.push(this.redis.connect());
    }
    if (this.postgres) {
      promises.push(this.postgres.initialize());
    }

    await Promise.all(promises);
  }

  /**
   * Close connections
   */
  async disconnect(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.redis) {
      promises.push(this.redis.disconnect());
    }
    if (this.postgres) {
      promises.push(this.postgres.close());
    }

    await Promise.all(promises);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ redis: boolean; postgres: boolean }> {
    const [redis, postgres] = await Promise.all([
      this.redis?.ping() ?? Promise.resolve(false),
      this.postgres?.ping() ?? Promise.resolve(false),
    ]);
    return { redis, postgres };
  }

  // ============ Sessions ============

  /**
   * Create new session
   */
  async createSession(systemPrompt?: string): Promise<SessionData> {
    const now = new Date();
    const session: SessionData = {
      id: uuidv4(),
      messages: systemPrompt
        ? [{ role: 'system', content: systemPrompt, timestamp: now }]
        : [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    // Save to Redis (cache) and PostgreSQL (persistent)
    await this.saveSession(session);
    return session;
  }

  /**
   * Get session (tries Redis first, then PostgreSQL)
   */
  async getSession(id: string): Promise<SessionData | null> {
    // Try Redis cache first
    if (this.redis) {
      const cached = await this.redis.getSession(id);
      if (cached) return cached;
    }

    // Fall back to PostgreSQL
    if (this.postgres) {
      const stored = await this.postgres.getSession(id);
      if (stored) {
        // Repopulate Redis cache
        if (this.redis) {
          await this.redis.setSession(stored);
        }
        return stored;
      }
    }

    // In-memory fallback
    return this.memoryFallback.get(id) ?? null;
  }

  /**
   * Save session to all backends
   */
  async saveSession(session: SessionData): Promise<void> {
    session.updatedAt = new Date();

    const promises: Promise<void>[] = [];

    if (this.redis) {
      promises.push(this.redis.setSession(session));
    }
    if (this.postgres) {
      promises.push(this.postgres.saveSession(session));
    }

    // In-memory fallback
    this.memoryFallback.set(session.id, session);

    await Promise.all(promises);
  }

  /**
   * Add message to session
   */
  async addMessage(sessionId: string, message: Omit<MessageData, 'timestamp'>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.messages.push({
      ...message,
      timestamp: new Date(),
    });

    await this.saveSession(session);
  }

  /**
   * Delete session
   */
  async deleteSession(id: string): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.redis) {
      promises.push(this.redis.deleteSession(id));
    }
    if (this.postgres) {
      promises.push(this.postgres.deleteSession(id));
    }

    this.memoryFallback.delete(id);

    await Promise.all(promises);
  }

  /**
   * List sessions
   */
  async listSessions(limit = 100): Promise<string[]> {
    if (this.redis) {
      return this.redis.listSessions();
    }
    if (this.postgres) {
      const sessions = await this.postgres.listSessions(limit);
      return sessions.map((s) => s.id);
    }
    return Array.from(this.memoryFallback.keys());
  }

  // ============ Realtime State ============

  /**
   * Get realtime state
   */
  async getRealtimeState(): Promise<RealtimeState> {
    if (this.redis) {
      const state = await this.redis.getRealtimeState();
      if (state) return state;
    }

    // Default state
    return {
      status: 'idle',
      lastActivity: new Date(),
      data: {},
    };
  }

  /**
   * Update realtime state
   */
  async updateRealtimeState(updates: Partial<RealtimeState>): Promise<void> {
    if (this.redis) {
      await this.redis.updateRealtimeState({
        ...updates,
        lastActivity: new Date(),
      });
    }
  }

  /**
   * Set agent status
   */
  async setStatus(status: RealtimeState['status'], task?: string): Promise<void> {
    await this.updateRealtimeState({
      status,
      currentTask: task,
    });
  }

  // ============ Request Queue ============

  /**
   * Enqueue request
   */
  async enqueueRequest(request: Record<string, string>): Promise<string | null> {
    if (!this.redis) return null;
    return this.redis.enqueueRequest(request);
  }

  /**
   * Dequeue requests
   */
  async dequeueRequests(
    group: string,
    consumer: string,
    count?: number
  ): Promise<Array<{ id: string; data: Record<string, string> }>> {
    if (!this.redis) return [];
    return this.redis.dequeueRequests(group, consumer, count);
  }

  /**
   * Acknowledge request
   */
  async ackRequest(group: string, id: string): Promise<void> {
    if (this.redis) {
      await this.redis.ackRequest(group, id);
    }
  }

  // ============ Events ============

  /**
   * Log event
   */
  async logEvent(
    type: string,
    data: Record<string, unknown>,
    sessionId?: string
  ): Promise<void> {
    const event: Omit<StateEvent, 'id'> = {
      type,
      sessionId,
      timestamp: new Date(),
      data,
    };

    // Publish to Redis for real-time subscribers
    if (this.redis) {
      await this.redis.publishEvent('events', { id: uuidv4(), ...event });
    }

    // Persist to PostgreSQL
    if (this.postgres) {
      await this.postgres.logEvent(event);
    }
  }

  /**
   * Subscribe to events
   */
  async subscribeEvents(callback: (event: StateEvent) => void): Promise<void> {
    if (this.redis) {
      await this.redis.subscribe('events', callback);
    }
  }

  /**
   * Get recent events
   */
  async getRecentEvents(limit = 100): Promise<StateEvent[]> {
    if (this.postgres) {
      return this.postgres.getEvents(limit);
    }
    return [];
  }

  // ============ Memory ============

  /**
   * Save memory entry
   */
  async saveMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
    if (!this.postgres) {
      throw new Error('PostgreSQL required for memory storage');
    }

    const fullEntry: MemoryEntry = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date(),
    };

    await this.postgres.saveMemory(fullEntry);
    return fullEntry.id;
  }

  /**
   * Search memory
   */
  async searchMemory(type: string, limit = 50): Promise<MemoryEntry[]> {
    if (!this.postgres) return [];
    return this.postgres.searchMemory(type, limit);
  }

  // ============ Metrics ============

  /**
   * Log metric
   */
  async logMetric(
    kpiId: string,
    value: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.postgres) return;

    await this.postgres.logMetric({
      kpiId,
      value,
      timestamp: new Date(),
      metadata,
    });
  }

  /**
   * Get metrics
   */
  async getMetrics(
    kpiId: string,
    startDate: Date,
    endDate: Date
  ): Promise<MetricEntry[]> {
    if (!this.postgres) return [];
    return this.postgres.getMetrics(kpiId, startDate, endDate);
  }

  /**
   * Create from environment variables
   */
  static fromEnv(): StateService {
    const config: StateConfig = {};

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      config.redis = {
        url: redisUrl,
        prefix: process.env.REDIS_PREFIX || 'pai:',
      };
    }

    const pgUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (pgUrl) {
      config.postgres = {
        connectionString: pgUrl,
      };
    }

    return new StateService(config);
  }
}
