#!/usr/bin/env bun
/**
 * Multi-Source Collection Script
 *
 * Automated collection from:
 * - News RSS feeds (18 sources)
 * - YouTube channels (12 sources)
 * - Reddit subreddits (12 sources)
 * - Fact-checkers (6 sources)
 * - Tech news (10 sources)
 * - Automotive news (6 sources)
 * - Energy/utility news (7 sources)
 *
 * Usage:
 *   bun run src/collect.ts              # Collect from all sources
 *   bun run src/collect.ts --quiet      # Minimal output
 *   bun run src/collect.ts --embeddings # Also generate embeddings
 *   bun run src/collect.ts --news       # News only
 *   bun run src/collect.ts --youtube    # YouTube only
 *   bun run src/collect.ts --reddit     # Reddit only
 *   bun run src/collect.ts --factcheck  # Fact-checkers only
 *   bun run src/collect.ts --tech       # Tech news only
 *   bun run src/collect.ts --auto       # Automotive news only
 *   bun run src/collect.ts --energy     # Energy/utility news only
 */

import Parser from 'rss-parser';
import { NEWS_SOURCES, type NewsSource } from './sources';
import { YOUTUBE_CHANNELS, getYouTubeRssUrl, type YouTubeChannel } from './sources-youtube';
import { REDDIT_SUBREDDITS, getRedditRssUrl, type RedditSubreddit } from './sources-reddit';
import { FACTCHECK_SOURCES, type FactCheckSource } from './sources-factcheck';
import { TECH_SOURCES, type TechSource } from './sources-tech';
import { AUTO_SOURCES, type AutoSource } from './sources-auto';
import { ENERGY_SOURCES, type EnergySource } from './sources-energy';
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
    factcheck: { inserted: number; sources: number };
    tech: { inserted: number; sources: number };
    auto: { inserted: number; sources: number };
    energy: { inserted: number; sources: number };
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
// FACT-CHECK COLLECTION
// ============================================================================

async function fetchFromFactCheck(source: FactCheckSource): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const feed = await parser.parseURL(source.rssUrl);

    const articles = (feed.items || []).slice(0, 20).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 500) || item.content?.slice(0, 500),
      source_name: source.name,
      source_type: 'factcheck' as SourceType,
      bias: source.bias,
      published_at: item.pubDate || item.isoDate || new Date().toISOString()
    }));

    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectFactCheck(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n🔍 Collecting from FACT-CHECKERS...');

  const results: SourceResult[] = [];

  for (const source of FACTCHECK_SOURCES) {
    upsertSource({
      name: source.name,
      source_type: 'factcheck',
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });

    const { articles, error } = await fetchFromFactCheck(source);

    if (error) {
      results.push({ name: source.name, type: 'factcheck', success: false, articlesInserted: 0, error });
      log(`  ✗ ${source.name}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(source.name);
      results.push({ name: source.name, type: 'factcheck', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ ${source.name}: +${inserted}`);
    }
  }

  return results;
}

// ============================================================================
// TECH NEWS COLLECTION
// ============================================================================

async function fetchFromTech(source: TechSource): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const feed = await parser.parseURL(source.rssUrl);

    const articles = (feed.items || []).slice(0, 15).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 400) || item.content?.slice(0, 400),
      source_name: source.name,
      source_type: 'tech' as SourceType,
      bias: source.bias,
      published_at: item.pubDate || item.isoDate || new Date().toISOString()
    }));

    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectTech(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n💻 Collecting from TECH sources...');

  const results: SourceResult[] = [];

  for (const source of TECH_SOURCES) {
    upsertSource({
      name: source.name,
      source_type: 'tech',
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });

    const { articles, error } = await fetchFromTech(source);

    if (error) {
      results.push({ name: source.name, type: 'tech', success: false, articlesInserted: 0, error });
      log(`  ✗ ${source.name}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(source.name);
      results.push({ name: source.name, type: 'tech', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ ${source.name}: +${inserted}`);
    }
  }

  return results;
}

// ============================================================================
// AUTOMOTIVE NEWS COLLECTION
// ============================================================================

async function fetchFromAuto(source: AutoSource): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const feed = await parser.parseURL(source.rssUrl);

    const articles = (feed.items || []).slice(0, 15).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 400) || item.content?.slice(0, 400),
      source_name: source.name,
      source_type: 'auto' as SourceType,
      bias: source.bias,
      published_at: item.pubDate || item.isoDate || new Date().toISOString()
    }));

    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectAuto(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n🚗 Collecting from AUTOMOTIVE sources...');

  const results: SourceResult[] = [];

  for (const source of AUTO_SOURCES) {
    upsertSource({
      name: source.name,
      source_type: 'auto',
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });

    const { articles, error } = await fetchFromAuto(source);

    if (error) {
      results.push({ name: source.name, type: 'auto', success: false, articlesInserted: 0, error });
      log(`  ✗ ${source.name}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(source.name);
      results.push({ name: source.name, type: 'auto', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ ${source.name}: +${inserted}`);
    }
  }

  return results;
}

// ============================================================================
// ENERGY/UTILITY COLLECTION
// ============================================================================

async function fetchFromEnergy(source: EnergySource): Promise<{ articles: ArticleInput[]; error?: string }> {
  try {
    const feed = await parser.parseURL(source.rssUrl);

    const articles = (feed.items || []).slice(0, 15).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 400) || item.content?.slice(0, 400),
      source_name: source.name,
      source_type: 'energy' as SourceType,
      bias: source.bias,
      published_at: item.pubDate || item.isoDate || new Date().toISOString()
    }));

    return { articles };
  } catch (error: any) {
    return { articles: [], error: error.message || 'Unknown error' };
  }
}

async function collectEnergy(log: (...args: any[]) => void): Promise<SourceResult[]> {
  log('\n⚡ Collecting from ENERGY sources...');

  const results: SourceResult[] = [];

  for (const source of ENERGY_SOURCES) {
    upsertSource({
      name: source.name,
      source_type: 'energy',
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });

    const { articles, error } = await fetchFromEnergy(source);

    if (error) {
      results.push({ name: source.name, type: 'energy', success: false, articlesInserted: 0, error });
      log(`  ✗ ${source.name}: ${error.slice(0, 50)}`);
    } else if (articles.length > 0) {
      const { inserted } = insertArticles(articles);
      updateSourceFetched(source.name);
      results.push({ name: source.name, type: 'energy', success: true, articlesInserted: inserted });
      if (inserted > 0) log(`  ✓ ${source.name}: +${inserted}`);
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
  factcheck?: boolean;
  tech?: boolean;
  auto?: boolean;
  energy?: boolean;
}): Promise<CollectionResult> {
  const log = options.quiet ? () => {} : console.log;

  // Default: collect all if no specific source type requested
  const collectAll = !options.news && !options.youtube && !options.reddit && !options.factcheck && !options.tech && !options.auto && !options.energy;
  const shouldCollectNews = collectAll || options.news;
  const shouldCollectYouTube = collectAll || options.youtube;
  const shouldCollectReddit = collectAll || options.reddit;
  const shouldCollectFactCheck = collectAll || options.factcheck;
  const shouldCollectTech = collectAll || options.tech;
  const shouldCollectAuto = collectAll || options.auto;
  const shouldCollectEnergy = collectAll || options.energy;

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
      reddit: { inserted: 0, sources: 0 },
      factcheck: { inserted: 0, sources: 0 },
      tech: { inserted: 0, sources: 0 },
      auto: { inserted: 0, sources: 0 },
      energy: { inserted: 0, sources: 0 }
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

  if (shouldCollectFactCheck) {
    const factcheckResults = await collectFactCheck(log);
    result.sources.push(...factcheckResults);
    result.byType.factcheck.sources = factcheckResults.length;
    result.byType.factcheck.inserted = factcheckResults.reduce((sum, r) => sum + r.articlesInserted, 0);
  }

  if (shouldCollectTech) {
    const techResults = await collectTech(log);
    result.sources.push(...techResults);
    result.byType.tech.sources = techResults.length;
    result.byType.tech.inserted = techResults.reduce((sum, r) => sum + r.articlesInserted, 0);
  }

  if (shouldCollectAuto) {
    const autoResults = await collectAuto(log);
    result.sources.push(...autoResults);
    result.byType.auto.sources = autoResults.length;
    result.byType.auto.inserted = autoResults.reduce((sum, r) => sum + r.articlesInserted, 0);
  }

  if (shouldCollectEnergy) {
    const energyResults = await collectEnergy(log);
    result.sources.push(...energyResults);
    result.byType.energy.sources = energyResults.length;
    result.byType.energy.inserted = energyResults.reduce((sum, r) => sum + r.articlesInserted, 0);
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
  log(`  📰 News:      +${result.byType.news.inserted} from ${result.byType.news.sources} sources`);
  log(`  📺 YouTube:   +${result.byType.youtube.inserted} from ${result.byType.youtube.sources} channels`);
  log(`  🔗 Reddit:    +${result.byType.reddit.inserted} from ${result.byType.reddit.sources} subreddits`);
  log(`  🔍 FactCheck: +${result.byType.factcheck.inserted} from ${result.byType.factcheck.sources} sources`);
  log(`  💻 Tech:      +${result.byType.tech.inserted} from ${result.byType.tech.sources} sources`);
  log(`  🚗 Auto:      +${result.byType.auto.inserted} from ${result.byType.auto.sources} sources`);
  log(`  ⚡ Energy:    +${result.byType.energy.inserted} from ${result.byType.energy.sources} sources`);
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
    reddit: args.includes('--reddit'),
    factcheck: args.includes('--factcheck'),
    tech: args.includes('--tech'),
    auto: args.includes('--auto'),
    energy: args.includes('--energy')
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Multi-Source Collection Script

Collects content from balanced sources across the political spectrum:
  • 18 News RSS feeds
  • 12 YouTube channels
  • 12 Reddit subreddits
  • 6 Fact-checkers (IFCN certified)
  • 10 Tech news sources
  • 6 Automotive news sources
  • 7 Energy/utility sources

Usage:
  bun run collect              # Collect from all sources
  bun run collect --quiet      # Minimal output (for cron)
  bun run collect --embeddings # Also generate embeddings
  bun run collect --news       # News RSS only
  bun run collect --youtube    # YouTube only
  bun run collect --reddit     # Reddit only
  bun run collect --factcheck  # Fact-checkers only
  bun run collect --tech       # Tech news only
  bun run collect --auto       # Automotive news only
  bun run collect --energy     # Energy/utility news only

Combinations:
  bun run collect --tech --energy  # Tech + energy

Schedule with launchd (macOS):
  See com.pai.info-hygiene.plist
`);
    return;
  }

  await collect(options);
}

main().catch(console.error);
