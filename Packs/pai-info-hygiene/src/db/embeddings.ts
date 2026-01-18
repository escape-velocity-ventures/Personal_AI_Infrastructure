/**
 * Embeddings Module
 *
 * Generates and stores embeddings for semantic similarity search.
 * Uses Ollama for local embedding generation.
 * Falls back to keyword-based similarity if Ollama unavailable.
 */

import { execSync } from 'child_process';
import { getDb, type Article } from './schema';

const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIM = 768; // nomic-embed-text dimension

// ============================================================================
// OLLAMA EMBEDDING GENERATION
// ============================================================================

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    // Check if Ollama is available
    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text.slice(0, 8000) // Limit text length
      })
    });

    if (!response.ok) {
      console.warn('Ollama embedding failed:', response.status);
      return null;
    }

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  } catch (error) {
    // Ollama not running or model not available
    return null;
  }
}

export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (!response.ok) return false;

    const data = await response.json() as { models: { name: string }[] };
    return data.models.some(m => m.name.includes('nomic-embed'));
  } catch {
    return false;
  }
}

export async function pullEmbeddingModel(): Promise<boolean> {
  try {
    console.log('Pulling embedding model (this may take a moment)...');
    execSync(`ollama pull ${EMBEDDING_MODEL}`, {
      stdio: 'inherit',
      timeout: 300000 // 5 minutes
    });
    return true;
  } catch {
    console.warn('Failed to pull embedding model. Vector search will be unavailable.');
    return false;
  }
}

// ============================================================================
// EMBEDDING STORAGE AND SEARCH
// ============================================================================

export function storeEmbedding(articleId: string, embedding: number[]): void {
  const db = getDb();
  db.run(
    'UPDATE articles SET embedding = ? WHERE id = ?',
    [JSON.stringify(embedding), articleId]
  );
}

export function getEmbedding(articleId: string): number[] | null {
  const db = getDb();
  const article = db.query('SELECT embedding FROM articles WHERE id = ?').get(articleId) as { embedding: string | null } | null;

  if (!article?.embedding) return null;
  return JSON.parse(article.embedding);
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export interface SimilarArticle {
  article: Article;
  similarity: number;
}

export function findSimilarArticles(
  embedding: number[],
  limit: number = 10,
  biasFilter?: string[]
): SimilarArticle[] {
  const db = getDb();

  // Get all articles with embeddings
  let query = 'SELECT * FROM articles WHERE embedding IS NOT NULL';
  if (biasFilter && biasFilter.length > 0) {
    query += ` AND bias IN (${biasFilter.map(b => `'${b}'`).join(',')})`;
  }

  const articles = db.query(query).all() as Article[];

  // Calculate similarities
  const similarities: SimilarArticle[] = [];

  for (const article of articles) {
    if (!article.embedding) continue;

    const articleEmbedding = JSON.parse(article.embedding) as number[];
    const similarity = cosineSimilarity(embedding, articleEmbedding);

    similarities.push({ article, similarity });
  }

  // Sort by similarity and return top N
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function findOpposingArticles(
  articleId: string,
  limit: number = 5
): Promise<SimilarArticle[]> {
  const db = getDb();
  const article = db.query('SELECT * FROM articles WHERE id = ?').get(articleId) as Article | null;

  if (!article) return [];

  const embedding = article.embedding ? JSON.parse(article.embedding) as number[] : null;

  if (!embedding) {
    // Fall back to keyword search
    return findOpposingByKeywords(article, limit);
  }

  // Determine opposing biases
  const opposingBiases = article.bias.includes('left')
    ? ['right', 'lean-right']
    : ['left', 'lean-left'];

  return findSimilarArticles(embedding, limit, opposingBiases);
}

// Fallback: keyword-based opposing article search
function findOpposingByKeywords(article: Article, limit: number): SimilarArticle[] {
  const db = getDb();

  // Extract keywords from title
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
  const keywords = article.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);

  if (keywords.length === 0) return [];

  // Determine opposing biases
  const opposingBiases = article.bias.includes('left')
    ? ['right', 'lean-right']
    : ['left', 'lean-left'];

  // Build search query
  const conditions = keywords.map(() => '(title LIKE ? OR snippet LIKE ?)').join(' OR ');
  const params = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);

  const query = `
    SELECT *, 1.0 as similarity FROM articles
    WHERE (${conditions})
      AND bias IN (${opposingBiases.map(b => `'${b}'`).join(',')})
      AND id != ?
    ORDER BY published_at DESC
    LIMIT ?
  `;

  const articles = db.query(query).all(...params, article.id, limit) as (Article & { similarity: number })[];

  return articles.map(a => ({
    article: a,
    similarity: 0.5 // Placeholder similarity for keyword matches
  }));
}

// ============================================================================
// BATCH EMBEDDING GENERATION
// ============================================================================

export async function generateMissingEmbeddings(batchSize: number = 50): Promise<number> {
  const db = getDb();

  // Check if Ollama is available
  const ollamaAvailable = await checkOllamaAvailable();
  if (!ollamaAvailable) {
    console.log('Ollama not available. Skipping embedding generation.');
    return 0;
  }

  // Get articles without embeddings
  const articles = db.query(`
    SELECT id, title, snippet FROM articles
    WHERE embedding IS NULL
    ORDER BY fetched_at DESC
    LIMIT ?
  `).all(batchSize) as { id: string; title: string; snippet: string | null }[];

  let generated = 0;

  for (const article of articles) {
    const text = `${article.title}\n${article.snippet || ''}`;
    const embedding = await generateEmbedding(text);

    if (embedding) {
      storeEmbedding(article.id, embedding);
      generated++;
    }

    // Small delay to avoid overwhelming Ollama
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return generated;
}

export function getEmbeddingStats(): { total: number; withEmbedding: number; percentage: number } {
  const db = getDb();

  const total = (db.query('SELECT COUNT(*) as c FROM articles').get() as { c: number }).c;
  const withEmbedding = (db.query('SELECT COUNT(*) as c FROM articles WHERE embedding IS NOT NULL').get() as { c: number }).c;

  return {
    total,
    withEmbedding,
    percentage: total > 0 ? Math.round((withEmbedding / total) * 100) : 0
  };
}
