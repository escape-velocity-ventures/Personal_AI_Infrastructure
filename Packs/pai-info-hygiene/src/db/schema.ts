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
export type SourceType = 'news' | 'youtube' | 'reddit' | 'factcheck' | 'tech' | 'auto' | 'energy' | 'policy';
export type ContentType = 'wire' | 'reporting' | 'analysis' | 'opinion' | 'editorial' | 'unknown';

export interface Article {
  id: string;
  url: string;
  title: string;
  content: string | null;
  snippet: string | null;
  source_name: string;
  source_type: SourceType;
  bias: BiasRating;
  published_at: string;
  fetched_at: string;
  entities: string | null; // JSON array
  topics: string | null; // JSON array
  framing_keywords: string | null; // JSON array
  sentiment: number | null;
  embedding: string | null; // JSON array of floats
  // Content analysis fields
  content_type: ContentType;
  content_type_confidence: number | null;
  is_primary_source: boolean | null;
  named_source_count: number | null;
  anonymous_source_count: number | null;
  emotional_language_score: number | null;
  loaded_terms: string | null; // JSON array of detected loaded terms
}

export interface ArticleAnalysis {
  id: string;
  article_id: string;
  analyzed_at: string;
  // Verifiable claims extracted
  claims: string; // JSON array of VerifiableClaim
  statistics: string; // JSON array of Statistic
  entities: string; // JSON array of NamedEntity
  // Narrative analysis
  framing: string | null;
  headline_neutralized: string | null;
  implied_conclusion: string | null;
}

export interface TriangulationEvent {
  id: string;
  event_description: string;
  created_at: string;
  // Aggregated results
  agreed_facts: string; // JSON array
  contested_claims: string; // JSON array
  framing_differences: string; // JSON array
  omissions: string; // JSON array
}

export interface TriangulatedArticle {
  event_id: string;
  article_id: string;
  source_name: string;
  bias: BiasRating;
  content_type: ContentType;
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
  source_type: SourceType;
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
      source_type TEXT NOT NULL DEFAULT 'news',
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
      source_type TEXT NOT NULL DEFAULT 'news',
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

  // Migration: Add source_type column if it doesn't exist
  try {
    db.run('ALTER TABLE sources ADD COLUMN source_type TEXT NOT NULL DEFAULT \'news\'');
  } catch { /* column already exists */ }

  try {
    db.run('ALTER TABLE articles ADD COLUMN source_type TEXT NOT NULL DEFAULT \'news\'');
  } catch { /* column already exists */ }

  // Migration: Add content analysis columns
  const contentAnalysisMigrations = [
    'ALTER TABLE articles ADD COLUMN content_type TEXT DEFAULT \'unknown\'',
    'ALTER TABLE articles ADD COLUMN content_type_confidence REAL',
    'ALTER TABLE articles ADD COLUMN is_primary_source INTEGER',
    'ALTER TABLE articles ADD COLUMN named_source_count INTEGER',
    'ALTER TABLE articles ADD COLUMN anonymous_source_count INTEGER',
    'ALTER TABLE articles ADD COLUMN emotional_language_score REAL',
    'ALTER TABLE articles ADD COLUMN loaded_terms TEXT',
  ];
  for (const migration of contentAnalysisMigrations) {
    try { db.run(migration); } catch { /* column already exists */ }
  }

  // Create article_analysis table for detailed analysis results
  db.run(`
    CREATE TABLE IF NOT EXISTS article_analysis (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL UNIQUE,
      analyzed_at TEXT NOT NULL,
      claims TEXT,
      statistics TEXT,
      entities TEXT,
      framing TEXT,
      headline_neutralized TEXT,
      implied_conclusion TEXT,
      FOREIGN KEY (article_id) REFERENCES articles(id)
    )
  `);

  // Create triangulation tables for cross-source comparison
  db.run(`
    CREATE TABLE IF NOT EXISTS triangulation_events (
      id TEXT PRIMARY KEY,
      event_description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      agreed_facts TEXT,
      contested_claims TEXT,
      framing_differences TEXT,
      omissions TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS triangulated_articles (
      event_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      bias TEXT NOT NULL,
      content_type TEXT DEFAULT 'unknown',
      PRIMARY KEY (event_id, article_id),
      FOREIGN KEY (event_id) REFERENCES triangulation_events(id),
      FOREIGN KEY (article_id) REFERENCES articles(id)
    )
  `);

  // Index for content type queries
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_content_type ON articles(content_type)');

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
