/**
 * PostgreSQL Client
 *
 * Handles persistent storage:
 * - Session history
 * - Memory entries
 * - Event logs
 * - Metrics
 */

import { Pool, type PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { SessionData, MemoryEntry, MetricEntry, StateEvent } from './types';

const SCHEMA_SQL = `
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  messages JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

-- Memory entries table
CREATE TABLE IF NOT EXISTS memory_entries (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;

-- Events table (for observability)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id) WHERE session_id IS NOT NULL;

-- Metrics table (for TELOS)
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY,
  kpi_id VARCHAR(100) NOT NULL,
  value NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_metrics_kpi ON metrics(kpi_id, timestamp DESC);
`;

export class PostgresStateClient {
  private pool: Pool;
  private initialized = false;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await this.pool.connect();
    try {
      // Check if pgvector extension exists (optional)
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      } catch {
        // pgvector not available, skip embedding support
        console.warn('pgvector extension not available, embeddings disabled');
      }

      await client.query(SCHEMA_SQL);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  /**
   * Close connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT 1');
      return result.rows.length === 1;
    } catch {
      return false;
    }
  }

  // ============ Sessions ============

  /**
   * Save session (insert or update)
   */
  async saveSession(session: SessionData): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, messages, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         messages = $2,
         metadata = $3,
         updated_at = $5`,
      [
        session.id,
        JSON.stringify(session.messages),
        JSON.stringify(session.metadata),
        session.createdAt,
        session.updatedAt,
      ]
    );
  }

  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<SessionData | null> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      messages: row.messages,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Delete session
   */
  async deleteSession(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id]);
  }

  /**
   * List recent sessions
   */
  async listSessions(limit = 100, offset = 0): Promise<SessionData[]> {
    const result = await this.pool.query(
      'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return result.rows.map((row) => ({
      id: row.id,
      messages: row.messages,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ============ Memory Entries ============

  /**
   * Save memory entry
   */
  async saveMemory(entry: MemoryEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory_entries (id, type, content, metadata, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         content = $3,
         metadata = $4,
         expires_at = $6`,
      [
        entry.id,
        entry.type,
        entry.content,
        JSON.stringify(entry.metadata),
        entry.createdAt,
        entry.expiresAt || null,
      ]
    );
  }

  /**
   * Get memory entry by ID
   */
  async getMemory(id: string): Promise<MemoryEntry | null> {
    const result = await this.pool.query(
      'SELECT * FROM memory_entries WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Search memory entries by type
   */
  async searchMemory(
    type: string,
    limit = 50
  ): Promise<MemoryEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM memory_entries
       WHERE type = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT $2`,
      [type, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  /**
   * Delete expired memory entries
   */
  async cleanupExpiredMemory(): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at < NOW()'
    );
    return result.rowCount || 0;
  }

  // ============ Events ============

  /**
   * Log event
   */
  async logEvent(event: Omit<StateEvent, 'id'>): Promise<string> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO events (id, type, session_id, timestamp, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        event.type,
        event.sessionId || null,
        event.timestamp,
        JSON.stringify(event.data),
      ]
    );
    return id;
  }

  /**
   * Get recent events
   */
  async getEvents(limit = 100, offset = 0): Promise<StateEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM events ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      data: row.data,
    }));
  }

  /**
   * Get events by session
   */
  async getEventsBySession(sessionId: string, limit = 100): Promise<StateEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE session_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [sessionId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      data: row.data,
    }));
  }

  // ============ Metrics ============

  /**
   * Log metric
   */
  async logMetric(entry: Omit<MetricEntry, 'id'>): Promise<string> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO metrics (id, kpi_id, value, timestamp, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        entry.kpiId,
        entry.value,
        entry.timestamp,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
    return id;
  }

  /**
   * Get metrics for KPI
   */
  async getMetrics(
    kpiId: string,
    startDate: Date,
    endDate: Date
  ): Promise<MetricEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM metrics
       WHERE kpi_id = $1 AND timestamp >= $2 AND timestamp <= $3
       ORDER BY timestamp DESC`,
      [kpiId, startDate, endDate]
    );

    return result.rows.map((row) => ({
      id: row.id,
      kpiId: row.kpi_id,
      value: parseFloat(row.value),
      timestamp: row.timestamp,
      metadata: row.metadata,
    }));
  }

  /**
   * Get latest metric value for KPI
   */
  async getLatestMetric(kpiId: string): Promise<MetricEntry | null> {
    const result = await this.pool.query(
      'SELECT * FROM metrics WHERE kpi_id = $1 ORDER BY timestamp DESC LIMIT 1',
      [kpiId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      kpiId: row.kpi_id,
      value: parseFloat(row.value),
      timestamp: row.timestamp,
      metadata: row.metadata,
    };
  }

  /**
   * Aggregate metrics (for dashboards)
   */
  async aggregateMetrics(
    kpiId: string,
    startDate: Date,
    endDate: Date,
    aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count'
  ): Promise<number> {
    const aggFn = aggregation.toUpperCase();
    const result = await this.pool.query(
      `SELECT ${aggFn}(value) as result FROM metrics
       WHERE kpi_id = $1 AND timestamp >= $2 AND timestamp <= $3`,
      [kpiId, startDate, endDate]
    );

    return parseFloat(result.rows[0]?.result || '0');
  }
}
