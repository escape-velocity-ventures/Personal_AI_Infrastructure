/**
 * Redis Client
 *
 * Handles real-time state management:
 * - Session state
 * - Active status
 * - Pub/sub for events
 * - Request queue (Redis Streams)
 */

import { createClient, type RedisClientType } from 'redis';
import type { SessionData, RealtimeState, StateEvent } from './types';

export class RedisStateClient {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private prefix: string;
  private connected = false;

  constructor(url: string, prefix = 'pai:') {
    this.prefix = prefix;
    this.client = createClient({ url });
    this.subscriber = this.client.duplicate();

    this.client.on('error', (err) => console.error('Redis Client Error:', err));
    this.subscriber.on('error', (err) => console.error('Redis Subscriber Error:', err));
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    await this.subscriber.connect();
    this.connected = true;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.quit();
    await this.subscriber.quit();
    this.connected = false;
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  // ============ Session State ============

  /**
   * Store session data
   */
  async setSession(session: SessionData, ttlSeconds = 86400 * 7): Promise<void> {
    const key = `${this.prefix}session:${session.id}`;
    await this.client.set(key, JSON.stringify(session), { EX: ttlSeconds });
  }

  /**
   * Get session data
   */
  async getSession(id: string): Promise<SessionData | null> {
    const key = `${this.prefix}session:${id}`;
    const data = await this.client.get(key);
    if (!data) return null;

    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
      messages: parsed.messages.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    };
  }

  /**
   * Delete session
   */
  async deleteSession(id: string): Promise<void> {
    const key = `${this.prefix}session:${id}`;
    await this.client.del(key);
  }

  /**
   * List all session IDs
   */
  async listSessions(): Promise<string[]> {
    const pattern = `${this.prefix}session:*`;
    const keys = await this.client.keys(pattern);
    return keys.map((k) => k.replace(`${this.prefix}session:`, ''));
  }

  // ============ Realtime State ============

  /**
   * Set agent realtime state
   */
  async setRealtimeState(state: RealtimeState): Promise<void> {
    const key = `${this.prefix}state:realtime`;
    await this.client.hSet(key, {
      activeSession: state.activeSession || '',
      status: state.status,
      currentTask: state.currentTask || '',
      lastActivity: state.lastActivity.toISOString(),
      data: JSON.stringify(state.data),
    });
  }

  /**
   * Get agent realtime state
   */
  async getRealtimeState(): Promise<RealtimeState | null> {
    const key = `${this.prefix}state:realtime`;
    const data = await this.client.hGetAll(key);
    if (!data || Object.keys(data).length === 0) return null;

    return {
      activeSession: data.activeSession || undefined,
      status: data.status as RealtimeState['status'],
      currentTask: data.currentTask || undefined,
      lastActivity: new Date(data.lastActivity),
      data: JSON.parse(data.data || '{}'),
    };
  }

  /**
   * Update specific state field
   */
  async updateRealtimeState(updates: Partial<RealtimeState>): Promise<void> {
    const key = `${this.prefix}state:realtime`;
    const fields: Record<string, string> = {};

    if (updates.activeSession !== undefined) fields.activeSession = updates.activeSession;
    if (updates.status !== undefined) fields.status = updates.status;
    if (updates.currentTask !== undefined) fields.currentTask = updates.currentTask;
    if (updates.lastActivity !== undefined) fields.lastActivity = updates.lastActivity.toISOString();
    if (updates.data !== undefined) fields.data = JSON.stringify(updates.data);

    if (Object.keys(fields).length > 0) {
      await this.client.hSet(key, fields);
    }
  }

  // ============ Request Queue (Redis Streams) ============

  /**
   * Add request to queue
   */
  async enqueueRequest(request: Record<string, string>): Promise<string> {
    const stream = `${this.prefix}requests`;
    return await this.client.xAdd(stream, '*', request);
  }

  /**
   * Read requests from queue (consumer group)
   */
  async dequeueRequests(
    group: string,
    consumer: string,
    count = 1,
    blockMs = 5000
  ): Promise<Array<{ id: string; data: Record<string, string> }>> {
    const stream = `${this.prefix}requests`;

    try {
      // Create consumer group if it doesn't exist
      await this.client.xGroupCreate(stream, group, '0', { MKSTREAM: true }).catch(() => {});

      const results = await this.client.xReadGroup(group, consumer, [
        { key: stream, id: '>' }
      ], { COUNT: count, BLOCK: blockMs });

      if (!results) return [];

      return results.flatMap((r) =>
        r.messages.map((m) => ({
          id: m.id,
          data: m.message as Record<string, string>,
        }))
      );
    } catch {
      return [];
    }
  }

  /**
   * Acknowledge processed request
   */
  async ackRequest(group: string, id: string): Promise<void> {
    const stream = `${this.prefix}requests`;
    await this.client.xAck(stream, group, id);
  }

  // ============ Pub/Sub Events ============

  /**
   * Publish event
   */
  async publishEvent(channel: string, event: StateEvent): Promise<void> {
    await this.client.publish(`${this.prefix}${channel}`, JSON.stringify(event));
  }

  /**
   * Subscribe to events
   */
  async subscribe(
    channel: string,
    callback: (event: StateEvent) => void
  ): Promise<void> {
    await this.subscriber.subscribe(`${this.prefix}${channel}`, (message) => {
      try {
        const event = JSON.parse(message);
        event.timestamp = new Date(event.timestamp);
        callback(event);
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    });
  }

  /**
   * Unsubscribe from channel
   */
  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(`${this.prefix}${channel}`);
  }

  // ============ Key-Value Store ============

  /**
   * Set a value with optional TTL
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const fullKey = `${this.prefix}${key}`;
    const data = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(fullKey, data, { EX: ttlSeconds });
    } else {
      await this.client.set(fullKey, data);
    }
  }

  /**
   * Get a value
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = `${this.prefix}${key}`;
    const data = await this.client.get(fullKey);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    const fullKey = `${this.prefix}${key}`;
    await this.client.del(fullKey);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = `${this.prefix}${key}`;
    return (await this.client.exists(fullKey)) === 1;
  }
}
