/**
 * Storage Layer
 *
 * CRUD operations for articles, sources, claims, and reading history.
 * Includes analytics queries for hygiene scoring.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, type Article, type Claim, type ReadingHistory, type Source, type BiasRating, type SourceType } from './schema';

// ============================================================================
// SOURCE OPERATIONS
// ============================================================================

export function upsertSource(source: Omit<Source, 'last_fetched' | 'article_count'>): void {
  const db = getDb();
  db.run(`
    INSERT INTO sources (name, source_type, bias, rss_url, website, article_count)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(name) DO UPDATE SET
      source_type = excluded.source_type,
      bias = excluded.bias,
      rss_url = excluded.rss_url,
      website = excluded.website
  `, [source.name, source.source_type || 'news', source.bias, source.rss_url, source.website]);
}

export function updateSourceFetched(name: string): void {
  const db = getDb();
  db.run(`
    UPDATE sources
    SET last_fetched = datetime('now'),
        article_count = (SELECT COUNT(*) FROM articles WHERE source_name = ?)
    WHERE name = ?
  `, [name, name]);
}

export function getSources(): Source[] {
  const db = getDb();
  return db.query('SELECT * FROM sources ORDER BY bias, name').all() as Source[];
}

// ============================================================================
// ARTICLE OPERATIONS
// ============================================================================

export interface ArticleInput {
  url: string;
  title: string;
  content?: string;
  snippet?: string;
  source_name: string;
  source_type?: SourceType;
  bias: BiasRating;
  published_at: string;
  entities?: string[];
  topics?: string[];
  framing_keywords?: string[];
  sentiment?: number;
  embedding?: number[];
}

export function insertArticle(article: ArticleInput): string | null {
  const db = getDb();
  const id = uuidv4();

  try {
    db.run(`
      INSERT INTO articles (
        id, url, title, content, snippet, source_name, source_type, bias,
        published_at, fetched_at, entities, topics, framing_keywords,
        sentiment, embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    `, [
      id,
      article.url,
      article.title,
      article.content || null,
      article.snippet || null,
      article.source_name,
      article.source_type || 'news',
      article.bias,
      article.published_at,
      article.entities ? JSON.stringify(article.entities) : null,
      article.topics ? JSON.stringify(article.topics) : null,
      article.framing_keywords ? JSON.stringify(article.framing_keywords) : null,
      article.sentiment || null,
      article.embedding ? JSON.stringify(article.embedding) : null
    ]);
    return id;
  } catch (error: any) {
    // Duplicate URL - article already exists
    if (error.message?.includes('UNIQUE constraint failed')) {
      return null;
    }
    throw error;
  }
}

export function insertArticles(articles: ArticleInput[]): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;

  for (const article of articles) {
    const id = insertArticle(article);
    if (id) {
      inserted++;
    } else {
      skipped++;
    }
  }

  return { inserted, skipped };
}

export function getArticle(id: string): Article | null {
  const db = getDb();
  return db.query('SELECT * FROM articles WHERE id = ?').get(id) as Article | null;
}

export function getArticleByUrl(url: string): Article | null {
  const db = getDb();
  return db.query('SELECT * FROM articles WHERE url = ?').get(url) as Article | null;
}

export function searchArticles(query: string, limit: number = 50): Article[] {
  const db = getDb();

  // Use FTS5 for full-text search
  return db.query(`
    SELECT a.*
    FROM articles a
    JOIN articles_fts fts ON a.rowid = fts.rowid
    WHERE articles_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as Article[];
}

export function searchArticlesByKeywords(keywords: string[], limit: number = 50): Article[] {
  const db = getDb();
  const pattern = keywords.map(k => `%${k}%`);

  // Build dynamic WHERE clause
  const conditions = keywords.map(() => '(title LIKE ? OR snippet LIKE ?)').join(' OR ');
  const params = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);

  return db.query(`
    SELECT * FROM articles
    WHERE ${conditions}
    ORDER BY published_at DESC
    LIMIT ?
  `).all(...params, limit) as Article[];
}

export function getArticlesByBias(bias: BiasRating, limit: number = 50): Article[] {
  const db = getDb();
  return db.query(`
    SELECT * FROM articles
    WHERE bias = ?
    ORDER BY published_at DESC
    LIMIT ?
  `).all(bias, limit) as Article[];
}

export function getArticlesBySource(sourceName: string, limit: number = 50): Article[] {
  const db = getDb();
  return db.query(`
    SELECT * FROM articles
    WHERE source_name = ?
    ORDER BY published_at DESC
    LIMIT ?
  `).all(sourceName, limit) as Article[];
}

export function getRecentArticles(hours: number = 24, limit: number = 200): Article[] {
  const db = getDb();
  return db.query(`
    SELECT * FROM articles
    WHERE fetched_at > datetime('now', '-' || ? || ' hours')
    ORDER BY published_at DESC
    LIMIT ?
  `).all(hours, limit) as Article[];
}

export function getArticleCount(): number {
  const db = getDb();
  const result = db.query('SELECT COUNT(*) as count FROM articles').get() as { count: number };
  return result.count;
}

// ============================================================================
// READING HISTORY
// ============================================================================

export function recordReading(articleId: string, timeSpentSeconds?: number, topic?: string): string {
  const db = getDb();
  const id = uuidv4();

  const article = getArticle(articleId);
  if (!article) {
    throw new Error(`Article ${articleId} not found`);
  }

  db.run(`
    INSERT INTO reading_history (id, article_id, read_at, time_spent_seconds, source_bias, topic)
    VALUES (?, ?, datetime('now'), ?, ?, ?)
  `, [id, articleId, timeSpentSeconds || null, article.bias, topic || null]);

  return id;
}

export function getReadingHistory(days: number = 7): ReadingHistory[] {
  const db = getDb();
  return db.query(`
    SELECT * FROM reading_history
    WHERE read_at > datetime('now', '-' || ? || ' days')
    ORDER BY read_at DESC
  `).all(days) as ReadingHistory[];
}

// ============================================================================
// CLAIMS
// ============================================================================

export function insertClaim(claim: Omit<Claim, 'id' | 'first_seen' | 'supporting_articles' | 'contradicting_articles' | 'fact_check_status' | 'fact_check_source'>): string {
  const db = getDb();
  const id = uuidv4();

  db.run(`
    INSERT INTO claims (id, text, article_id, source_bias, first_seen, fact_check_status)
    VALUES (?, ?, ?, ?, datetime('now'), 'unchecked')
  `, [id, claim.text, claim.article_id, claim.source_bias]);

  return id;
}

export function getClaims(articleId?: string): Claim[] {
  const db = getDb();

  if (articleId) {
    return db.query('SELECT * FROM claims WHERE article_id = ?').all(articleId) as Claim[];
  }

  return db.query('SELECT * FROM claims ORDER BY first_seen DESC').all() as Claim[];
}

// ============================================================================
// ANALYTICS QUERIES
// ============================================================================

export interface BiasBreakdown {
  bias: BiasRating;
  count: number;
  percentage: number;
}

export function getArticleBiasBreakdown(hours?: number): BiasBreakdown[] {
  const db = getDb();

  let query = `
    SELECT
      bias,
      COUNT(*) as count
    FROM articles
  `;

  if (hours) {
    query += ` WHERE fetched_at > datetime('now', '-' || ${hours} || ' hours')`;
  }

  query += ' GROUP BY bias';

  const results = db.query(query).all() as { bias: BiasRating; count: number }[];
  const total = results.reduce((sum, r) => sum + r.count, 0);

  return results.map(r => ({
    bias: r.bias,
    count: r.count,
    percentage: total > 0 ? Math.round((r.count / total) * 100) : 0
  }));
}

export function getReadingBiasBreakdown(days: number = 7): BiasBreakdown[] {
  const db = getDb();

  const results = db.query(`
    SELECT
      source_bias as bias,
      COUNT(*) as count
    FROM reading_history
    WHERE read_at > datetime('now', '-' || ? || ' days')
    GROUP BY source_bias
  `).all(days) as { bias: BiasRating; count: number }[];

  const total = results.reduce((sum, r) => sum + r.count, 0);

  return results.map(r => ({
    bias: r.bias,
    count: r.count,
    percentage: total > 0 ? Math.round((r.count / total) * 100) : 0
  }));
}

export interface DailyHygieneScore {
  date: string;
  articles_read: number;
  left_count: number;
  center_count: number;
  right_count: number;
  balance_score: number; // 0-100, higher is more balanced
}

export function getDailyHygieneScores(days: number = 7): DailyHygieneScore[] {
  const db = getDb();

  return db.query(`
    SELECT
      date(read_at) as date,
      COUNT(*) as articles_read,
      SUM(CASE WHEN source_bias IN ('left', 'lean-left') THEN 1 ELSE 0 END) as left_count,
      SUM(CASE WHEN source_bias = 'center' THEN 1 ELSE 0 END) as center_count,
      SUM(CASE WHEN source_bias IN ('right', 'lean-right') THEN 1 ELSE 0 END) as right_count,
      CAST(
        100 - (
          ABS(
            SUM(CASE WHEN source_bias IN ('left', 'lean-left') THEN 1 ELSE 0 END) -
            SUM(CASE WHEN source_bias IN ('right', 'lean-right') THEN 1 ELSE 0 END)
          ) * 100.0 /
          NULLIF(
            SUM(CASE WHEN source_bias IN ('left', 'lean-left') THEN 1 ELSE 0 END) +
            SUM(CASE WHEN source_bias IN ('right', 'lean-right') THEN 1 ELSE 0 END),
            0
          )
        )
        AS INTEGER
      ) as balance_score
    FROM reading_history
    WHERE read_at > datetime('now', '-' || ? || ' days')
    GROUP BY date(read_at)
    ORDER BY date DESC
  `).all(days) as DailyHygieneScore[];
}

export interface TopicCoverage {
  topic: string;
  total: number;
  left: number;
  lean_left: number;
  center: number;
  lean_right: number;
  right: number;
}

export function getTopicCoverage(topic: string): TopicCoverage {
  const db = getDb();

  const articles = searchArticlesByKeywords([topic], 500);

  const coverage: TopicCoverage = {
    topic,
    total: articles.length,
    left: 0,
    lean_left: 0,
    center: 0,
    lean_right: 0,
    right: 0
  };

  for (const article of articles) {
    switch (article.bias) {
      case 'left': coverage.left++; break;
      case 'lean-left': coverage.lean_left++; break;
      case 'center': coverage.center++; break;
      case 'lean-right': coverage.lean_right++; break;
      case 'right': coverage.right++; break;
    }
  }

  return coverage;
}

// ============================================================================
// MAINTENANCE
// ============================================================================

export function pruneOldArticles(daysToKeep: number = 90): number {
  const db = getDb();

  const result = db.run(`
    DELETE FROM articles
    WHERE fetched_at < datetime('now', '-' || ? || ' days')
  `, [daysToKeep]);

  return result.changes;
}

export function getDbStats(): { articles: number; sources: number; claims: number; readings: number } {
  const db = getDb();

  const articles = (db.query('SELECT COUNT(*) as c FROM articles').get() as { c: number }).c;
  const sources = (db.query('SELECT COUNT(*) as c FROM sources').get() as { c: number }).c;
  const claims = (db.query('SELECT COUNT(*) as c FROM claims').get() as { c: number }).c;
  const readings = (db.query('SELECT COUNT(*) as c FROM reading_history').get() as { c: number }).c;

  return { articles, sources, claims, readings };
}
