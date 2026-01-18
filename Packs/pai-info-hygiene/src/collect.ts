#!/usr/bin/env bun
/**
 * Multi-Source Collection Script
 *
 * Automated collection from:
 * - News RSS feeds (18 sources)
 * - YouTube channels (13 sources)
 * - Reddit subreddits (12 sources)
 *
 * Usage:
 *   bun run src/collect.ts              # Collect from all sources
 *   bun run src/collect.ts --quiet      # Minimal output
 *   bun run src/collect.ts --embeddings # Also generate embeddings
 *   bun run src/collect.ts --news       # News only
 *   bun run src/collect.ts --youtube    # YouTube only
 *   bun run src/collect.ts --reddit     # Reddit only
 */

import Parser from 'rss-parser';
import { NEWS_SOURCES, type NewsSource } from './sources';
import { YOUTUBE_CHANNELS, getYouTubeRssUrl, type YouTubeChannel } from './sources-youtube';
import { REDDIT_SUBREDDITS, getRedditRssUrl, type RedditSubreddit } from './sources-reddit';
import { getDb, type SourceType } from './db/schema';
import {
  upsertSource,
  updateSourceFetched,
  insertArticles,
  pruneOldArticles,
  getDbStats,
  type ArticleInput
} from './db/storage';
import { generateMissingEmbeddings, checkOllamaAvailable } from './db/embeddings';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'PAI-Info-Hygiene/1.0 (Personal AI Infrastructure)'
  }
});

interface SourceResult {
  name: string;
  type: SourceType;
  success: boolean;
  articlesInserted: number;
  error?: string;
}

interface CollectionResult {
  timestamp: Date;
  sources: SourceResult[];
  totalInserted: number;
  totalSkipped: number;
  embeddingsGenerated: number;
  pruned: number;
  byType: {
    news: { inserted: number; sources: number };
    youtube: { inserted: number; sources: number };
    reddit: { inserted: number; sources: number };
  };
}

// ============================================================================
// NEWS COLLECTION
// ============================================================================

async function fetchFromNewsSource(source: NewsSource): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    const articles = (feed.items || []).slice(0, 15).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 300),
      source_name: source.name,
      source_type: 'news' as SourceType,
      bias: source.bias,
      published_at: item.pubDate || new Date().toISOString()
    }));
    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectNews(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n📰 Collecting from NEWS sources...');

  const results: SourceResult[] = [];

  for (const source of NEWS_SOURCES) {
    upsertSource({
      name: source.name,
      source_type: 'news',
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });

    const { articles, error } = await fetchFromNewsSource(source);

    if (error) {
      results.push({ name: source.name, type: 'news', success: false, articlesInserted: 0, error });
      log(`  ✗ ${source.name}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(source.name);
      results.push({ name: source.name, type: 'news', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ ${source.name}: +${inserted}`);
    }
  }

  return results;
}

// ============================================================================
// YOUTUBE COLLECTION
// ============================================================================

async function fetchFromYouTube(channel: YouTubeChannel): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const rssUrl = getYouTubeRssUrl(channel);
    const feed = await parser.parseURL(rssUrl);

    const articles = (feed.items || []).slice(0, 10).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 300) || item.content?.slice(0, 300),
      source_name: channel.name,
      source_type: 'youtube' as SourceType,
      bias: channel.bias,
      published_at: item.pubDate || item.isoDate || new Date().toISOString()
    }));

    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectYouTube(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n📺 Collecting from YOUTUBE channels...');

  const results: SourceResult[] = [];

  for (const channel of YOUTUBE_CHANNELS) {
    upsertSource({
      name: channel.name,
      source_type: 'youtube',
      bias: channel.bias,
      rss_url: getYouTubeRssUrl(channel),
      website: `youtube.com/${channel.handle}`
    });

    const { articles, error } = await fetchFromYouTube(channel);

    if (error) {
      results.push({ name: channel.name, type: 'youtube', success: false, articlesInserted: 0, error });
      log(`  ✗ ${channel.name}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(channel.name);
      results.push({ name: channel.name, type: 'youtube', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ ${channel.name}: +${inserted}`);
    }
  }

  return results;
}

// ============================================================================
// REDDIT COLLECTION
// ============================================================================

async function fetchFromReddit(subreddit: RedditSubreddit): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const rssUrl = getRedditRssUrl(subreddit, 'top', 'day');
    const feed = await parser.parseURL(rssUrl);

    const articles = (feed.items || []).slice(0, 15).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 300),
      source_name: `r/${subreddit.subreddit}`,
      source_type: 'reddit' as SourceType,
      bias: subreddit.bias,
      published_at: item.pubDate || item.isoDate || new Date().toISOString()
    }));

    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectReddit(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n🔗 Collecting from REDDIT subreddits...');

  const results: SourceResult[] = [];

  for (const subreddit of REDDIT_SUBREDDITS) {
    upsertSource({
      name: `r/${subreddit.subreddit}`,
      source_type: 'reddit',
      bias: subreddit.bias,
      rss_url: getRedditRssUrl(subreddit, 'top', 'day'),
      website: `reddit.com/r/${subreddit.subreddit}`
    });

    const { articles, error } = await fetchFromReddit(subreddit);

    if (error) {
      results.push({ name: `r/${subreddit.subreddit}`, type: 'reddit', success: false, articlesInserted: 0, error });
      log(`  ✗ r/${subreddit.subreddit}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(`r/${subreddit.subreddit}`);
      results.push({ name: `r/${subreddit.subreddit}`, type: 'reddit', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ r/${subreddit.subreddit}: +${inserted}`);
    }
  }

  return results;
}

// ============================================================================
// MAIN COLLECTION
// ============================================================================

async function collect(options: {
  quiet?: boolean;
  embeddings?: boolean;
  news?: boolean;
  youtube?: boolean;
  reddit?: boolean;
}): Promise<CollectionResult> {
  const log = options.quiet ? () => {} : console.log;

  // Default: collect all if no specific source type requested
  const collectAll = !options.news && !options.youtube && !options.reddit;
  const shouldCollectNews = collectAll || options.news;
  const shouldCollectYouTube = collectAll || options.youtube;
  const shouldCollectReddit = collectAll || options.reddit;

  log(`[${new Date().toISOString()}] Starting multi-source collection...`);

  // Initialize database
  getDb();

  const result: CollectionResult = {
    timestamp: new Date(),
    sources: [],
    totalInserted: 0,
    totalSkipped: 0,
    embeddingsGenerated: 0,
    pruned: 0,
    byType: {
      news: { inserted: 0, sources: 0 },
      youtube: { inserted: 0, sources: 0 },
      reddit: { inserted: 0, sources: 0 }
    }
  };

  // Collect from each source type
  if (shouldCollectNews) {
    const newsResults = await collectNews(log);
    result.sources.push(...newsResults);
    result.byType.news.sources = newsResults.length;
    result.byType.news.inserted = newsResults.reduce((sum, r) => sum + r.articlesInserted, 0);
  }

  if (shouldCollectYouTube) {
    const youtubeResults = await collectYouTube(log);
    result.sources.push(...youtubeResults);
    result.byType.youtube.sources = youtubeResults.length;
    result.byType.youtube.inserted = youtubeResults.reduce((sum, r) => sum + r.articlesInserted, 0);
  }

  if (shouldCollectReddit) {
    const redditResults = await collectReddit(log);
    result.sources.push(...redditResults);
    result.byType.reddit.sources = redditResults.length;
    result.byType.reddit.inserted = redditResults.reduce((sum, r) => sum + r.articlesInserted, 0);
  }

  // Calculate totals
  result.totalInserted = result.sources.reduce((sum, r) => sum + r.articlesInserted, 0);

  // Generate embeddings if requested
  if (options.embeddings) {
    const ollamaAvailable = await checkOllamaAvailable();
    if (ollamaAvailable) {
      log('\n🧠 Generating embeddings...');
      result.embeddingsGenerated = await generateMissingEmbeddings(100);
      log(`  ✓ Generated ${result.embeddingsGenerated} embeddings`);
    } else {
      log('\n⚠ Ollama not available, skipping embeddings');
    }
  }

  // Prune old articles
  result.pruned = pruneOldArticles(90);
  if (result.pruned > 0) {
    log(`\n🧹 Pruned ${result.pruned} old articles`);
  }

  // Summary
  const stats = getDbStats();
  log('\n' + '═'.repeat(50));
  log(`[${new Date().toISOString()}] Collection complete`);
  log(`  📰 News:    +${result.byType.news.inserted} from ${result.byType.news.sources} sources`);
  log(`  📺 YouTube: +${result.byType.youtube.inserted} from ${result.byType.youtube.sources} channels`);
  log(`  🔗 Reddit:  +${result.byType.reddit.inserted} from ${result.byType.reddit.sources} subreddits`);
  log(`  ─────────────────────────`);
  log(`  Total: +${result.totalInserted} new | ${stats.articles} in database`);

  return result;
}

// Main
async function main() {
  const args = process.argv.slice(2);

  const options = {
    quiet: args.includes('--quiet') || args.includes('-q'),
    embeddings: args.includes('--embeddings') || args.includes('-e'),
    news: args.includes('--news'),
    youtube: args.includes('--youtube'),
    reddit: args.includes('--reddit')
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Multi-Source Collection Script

Collects content from balanced sources across the political spectrum:
  • 18 News RSS feeds
  • 13 YouTube channels
  • 12 Reddit subreddits

Usage:
  bun run collect              # Collect from all sources
  bun run collect --quiet      # Minimal output (for cron)
  bun run collect --embeddings # Also generate embeddings
  bun run collect --news       # News RSS only
  bun run collect --youtube    # YouTube only
  bun run collect --reddit     # Reddit only

Combinations:
  bun run collect --youtube --reddit  # YouTube + Reddit, skip news

Schedule with launchd (macOS):
  See com.pai.info-hygiene.plist
`);
    return;
  }

  await collect(options);
}

main().catch(console.error);
