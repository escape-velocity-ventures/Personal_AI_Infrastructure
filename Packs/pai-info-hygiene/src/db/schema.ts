/**
 * Database Schema and Types
 *
 * Uses Bun's built-in SQLite for persistent storage.
 * Includes tables for articles, claims, sources, and reading history.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Database location
const DATA_DIR = join(homedir(), '.cache', 'pai-info-hygiene');
const DB_PATH = join(DATA_DIR, 'hygiene.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Types matching our schema
export type BiasRating = 'left' | 'lean-left' | 'center' | 'lean-right' | 'right';

export interface Article {
  id: string;
  url: string;
  title: string;
  content: string | null;
  snippet: string | null;
  source_name: string;
  bias: BiasRating;
  published_at: string;
  fetched_at: string;
  entities: string | null; // JSON array
  topics: string | null; // JSON array
  framing_keywords: string | null; // JSON array
  sentiment: number | null;
  embedding: string | null; // JSON array of floats
}

export interface Claim {
  id: string;
  text: string;
  article_id: string;
  source_bias: BiasRating;
  first_seen: string;
  supporting_articles: string | null; // JSON array
  contradicting_articles: string | null; // JSON array
  fact_check_status: 'unchecked' | 'true' | 'false' | 'mixed';
  fact_check_source: string | null;
}

export interface ReadingHistory {
  id: string;
  article_id: string;
  read_at: string;
  time_spent_seconds: number | null;
  source_bias: BiasRating;
  topic: string | null;
}

export interface Source {
  name: string;
  bias: BiasRating;
  rss_url: string;
  website: string;
  last_fetched: string | null;
  article_count: number;
}

// Initialize database with schema
export function initDatabase(): Database {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.run('PRAGMA journal_mode = WAL');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS sources (
      name TEXT PRIMARY KEY,
      bias TEXT NOT NULL,
      rss_url TEXT NOT NULL,
      website TEXT NOT NULL,
      last_fetched TEXT,
      article_count INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      snippet TEXT,
      source_name TEXT NOT NULL,
      bias TEXT NOT NULL,
      published_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      entities TEXT,
      topics TEXT,
      framing_keywords TEXT,
      sentiment REAL,
      embedding TEXT,
      FOREIGN KEY (source_name) REFERENCES sources(name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      article_id TEXT NOT NULL,
      source_bias TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      supporting_articles TEXT,
      contradicting_articles TEXT,
      fact_check_status TEXT DEFAULT 'unchecked',
      fact_check_source TEXT,
      FOREIGN KEY (article_id) REFERENCES articles(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reading_history (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      time_spent_seconds INTEGER,
      source_bias TEXT NOT NULL,
      topic TEXT,
      FOREIGN KEY (article_id) REFERENCES articles(id)
    )
  `);

  // Create indexes for common queries
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_bias ON articles(bias)');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_fetched ON articles(fetched_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reading_read_at ON reading_history(read_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_claims_article ON claims(article_id)');

  // Create full-text search virtual table for articles
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      title,
      content,
      snippet,
      content='articles',
      content_rowid='rowid'
    )
  `);

  // Triggers to keep FTS in sync
  db.run(`
    CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
      INSERT INTO articles_fts(rowid, title, content, snippet)
      VALUES (NEW.rowid, NEW.title, NEW.content, NEW.snippet);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, content, snippet)
      VALUES('delete', OLD.rowid, OLD.title, OLD.content, OLD.snippet);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, content, snippet)
      VALUES('delete', OLD.rowid, OLD.title, OLD.content, OLD.snippet);
      INSERT INTO articles_fts(rowid, title, content, snippet)
      VALUES (NEW.rowid, NEW.title, NEW.content, NEW.snippet);
    END
  `);

  return db;
}

// Get singleton database instance
let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = initDatabase();
  }
  return dbInstance;
}

// Close database
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Export path for external use
export { DB_PATH, DATA_DIR };
