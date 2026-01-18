#!/usr/bin/env bun
/**
 * Collection Script
 *
 * Automated collection of articles from all sources.
 * Designed to run on a schedule (e.g., via cron or launchd).
 *
 * Usage:
 *   bun run src/collect.ts              # Collect articles
 *   bun run src/collect.ts --quiet      # Minimal output
 *   bun run src/collect.ts --embeddings # Also generate embeddings
 */

import Parser from 'rss-parser';
import { NEWS_SOURCES, type BiasRating, type NewsSource } from './sources';
import { getDb } from './db/schema';
import {
  upsertSource,
  updateSourceFetched,
  insertArticles,
  pruneOldArticles,
  getDbStats,
  type ArticleInput
} from './db/storage';
import { generateMissingEmbeddings, checkOllamaAvailable, getEmbeddingStats } from './db/embeddings';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'PAI-Info-Hygiene/1.0 (Personal AI Infrastructure)'
  }
});

interface CollectionResult {
  timestamp: Date;
  sources: {
    name: string;
    success: boolean;
    articlesInserted: number;
    error?: string;
  }[];
  totalInserted: number;
  totalSkipped: number;
  embeddingsGenerated: number;
  pruned: number;
}

async function fetchFromSource(source: NewsSource): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    const articles = (feed.items || []).slice(0, 15).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 300),
      source_name: source.name,
      bias: source.bias,
      published_at: item.pubDate || new Date().toISOString()
    }));
    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collect(options: { quiet?: boolean; embeddings?: boolean }): Promise<CollectionResult> {
  const log = options.quiet ? () => {} : console.log;

  log(`[${new Date().toISOString()}] Starting collection...`);

  // Initialize database and sources
  getDb();
  for (const source of NEWS_SOURCES) {
    upsertSource({
      name: source.name,
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });
  }

  const result: CollectionResult = {
    timestamp: new Date(),
    sources: [],
    totalInserted: 0,
    totalSkipped: 0,
    embeddingsGenerated: 0,
    pruned: 0
  };

  // Fetch from all sources
  for (const source of NEWS_SOURCES) {
    const { articles, error } = await fetchFromSource(source);

    if (error) {
      result.sources.push({
        name: source.name,
        success: false,
        articlesInserted: 0,
        error
      });
      log(`  ✗ ${source.name}: ${error}`);
    } else if (articles.length > 0) {
      const { inserted, skipped } = insertArticles(articles);
      updateSourceFetched(source.name);

      result.sources.push({
        name: source.name,
        success: true,
        articlesInserted: inserted
      });
      result.totalInserted += inserted;
      result.totalSkipped += skipped;

      if (inserted > 0) {
        log(`  ✓ ${source.name}: +${inserted} new articles`);
      }
    }
  }

  // Generate embeddings if requested and Ollama is available
  if (options.embeddings) {
    const ollamaAvailable = await checkOllamaAvailable();
    if (ollamaAvailable) {
      log('  Generating embeddings...');
      result.embeddingsGenerated = await generateMissingEmbeddings(50);
      log(`  ✓ Generated ${result.embeddingsGenerated} embeddings`);
    } else {
      log('  ⚠ Ollama not available, skipping embeddings');
    }
  }

  // Prune old articles (keep 90 days)
  result.pruned = pruneOldArticles(90);
  if (result.pruned > 0) {
    log(`  ✓ Pruned ${result.pruned} old articles`);
  }

  const stats = getDbStats();
  log(`\n[${new Date().toISOString()}] Collection complete`);
  log(`  New: ${result.totalInserted} | Skipped: ${result.totalSkipped} | Total: ${stats.articles}`);

  return result;
}

// Main
async function main() {
  const args = process.argv.slice(2);

  const options = {
    quiet: args.includes('--quiet') || args.includes('-q'),
    embeddings: args.includes('--embeddings') || args.includes('-e')
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Collection Script - Automated article fetching

Usage:
  bun run collect              # Collect articles
  bun run collect --quiet      # Minimal output (for cron)
  bun run collect --embeddings # Also generate embeddings

Schedule with cron:
  0 */4 * * * cd /path/to/pai-info-hygiene && bun run collect --quiet >> /tmp/hygiene.log 2>&1

Or with launchd (macOS):
  See com.pai.info-hygiene.plist in this directory
`);
    return;
  }

  await collect(options);
}

main().catch(console.error);
