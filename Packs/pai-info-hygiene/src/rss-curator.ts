#!/usr/bin/env bun
/**
 * RSS Curator Agent
 *
 * Fetches news from balanced sources across the political spectrum,
 * stores in persistent SQLite database, clusters stories by topic,
 * and generates a daily briefing highlighting competing narratives.
 *
 * Usage:
 *   bun run src/rss-curator.ts              # Fetch and store articles
 *   bun run src/rss-curator.ts --briefing   # Generate daily briefing
 *   bun run src/rss-curator.ts --topic X    # Find competing narratives on topic X
 *   bun run src/rss-curator.ts --stats      # Show database statistics
 */

import Parser from 'rss-parser';
import chalk from 'chalk';
import { NEWS_SOURCES, getBiasColor, getBiasLabel, type BiasRating, type NewsSource } from './sources';
import { getDb } from './db/schema';
import {
  upsertSource,
  updateSourceFetched,
  insertArticles,
  getRecentArticles,
  searchArticlesByKeywords,
  getArticleBiasBreakdown,
  getDbStats,
  type ArticleInput
} from './db/storage';
import { generateMissingEmbeddings, getEmbeddingStats } from './db/embeddings';

// Types
interface LegacyArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  bias: BiasRating;
  snippet?: string;
}

interface StoryCluster {
  id: string;
  topic: string;
  keywords: string[];
  articles: LegacyArticle[];
  biasBreakdown: Record<BiasRating, number>;
  hasCompetingNarratives: boolean;
}

// RSS Parser
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'PAI-Info-Hygiene/1.0 (Personal AI Infrastructure)'
  }
});

// Initialize sources in database
function initializeSources(): void {
  for (const source of NEWS_SOURCES) {
    upsertSource({
      name: source.name,
      bias: source.bias,
      rss_url: source.rssUrl,
      website: source.website
    });
  }
}

// Fetch articles from a single source
async function fetchFromSource(source: NewsSource): Promise<ArticleInput[]> {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    return (feed.items || []).slice(0, 10).map(item => ({
      url: item.link || '',
      title: item.title || 'Untitled',
      content: null,
      snippet: item.contentSnippet?.slice(0, 200),
      source_name: source.name,
      bias: source.bias,
      published_at: item.pubDate || new Date().toISOString()
    }));
  } catch (error) {
    console.error(chalk.dim(`  ⚠ Failed to fetch ${source.name}: ${error}`));
    return [];
  }
}

// Fetch from all sources and store in database
async function fetchAllArticles(): Promise<{ inserted: number; skipped: number; total: number }> {
  console.log(chalk.cyan('📡 Fetching from balanced sources...\n'));

  // Initialize sources
  initializeSources();

  const biasGroups: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right'];
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const bias of biasGroups) {
    const sources = NEWS_SOURCES.filter(s => s.bias === bias);
    console.log(chalk.dim(`  ${getBiasLabel(bias)}: ${sources.map(s => s.name).join(', ')}`));

    for (const source of sources) {
      const articles = await fetchFromSource(source);

      if (articles.length > 0) {
        const { inserted, skipped } = insertArticles(articles);
        totalInserted += inserted;
        totalSkipped += skipped;
        updateSourceFetched(source.name);
      }
    }
  }

  const stats = getDbStats();

  console.log(chalk.green(`\n✓ Fetched articles from ${NEWS_SOURCES.length} sources`));
  console.log(chalk.green(`  New: ${totalInserted} | Existing: ${totalSkipped} | Total in DB: ${stats.articles}`));

  return { inserted: totalInserted, skipped: totalSkipped, total: stats.articles };
}

// Extract keywords from title for clustering
function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
    'we', 'they', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
    'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 'just', 'says', 'said', 'new', 'after', 'before', 'now'
  ]);

  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));
}

// Calculate similarity between two articles based on keywords
function calculateSimilarity(a: LegacyArticle, b: LegacyArticle): number {
  const keywordsA = new Set(extractKeywords(a.title));
  const keywordsB = new Set(extractKeywords(b.title));

  if (keywordsA.size === 0 || keywordsB.size === 0) return 0;

  const intersection = [...keywordsA].filter(k => keywordsB.has(k));
  const union = new Set([...keywordsA, ...keywordsB]);

  return intersection.length / union.size; // Jaccard similarity
}

// Cluster articles by topic
function clusterArticles(articles: LegacyArticle[]): StoryCluster[] {
  const clusters: StoryCluster[] = [];
  const assigned = new Set<number>();

  const SIMILARITY_THRESHOLD = 0.2;

  for (let i = 0; i < articles.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: LegacyArticle[] = [articles[i]];
    assigned.add(i);

    for (let j = i + 1; j < articles.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = calculateSimilarity(articles[i], articles[j]);
      if (similarity >= SIMILARITY_THRESHOLD) {
        cluster.push(articles[j]);
        assigned.add(j);
      }
    }

    const uniqueSources = new Set(cluster.map(a => a.source));
    if (cluster.length >= 2 && uniqueSources.size >= 2) {
      const biasBreakdown: Record<BiasRating, number> = {
        'left': 0, 'lean-left': 0, 'center': 0, 'lean-right': 0, 'right': 0
      };
      cluster.forEach(a => biasBreakdown[a.bias]++);

      const uniqueBiases = Object.values(biasBreakdown).filter(v => v > 0).length;

      clusters.push({
        id: `cluster-${clusters.length}`,
        topic: extractKeywords(articles[i].title).slice(0, 5).join(' '),
        keywords: extractKeywords(articles[i].title),
        articles: cluster,
        biasBreakdown,
        hasCompetingNarratives: uniqueBiases >= 3
      });
    }
  }

  clusters.sort((a, b) => {
    const diversityA = Object.values(a.biasBreakdown).filter(v => v > 0).length;
    const diversityB = Object.values(b.biasBreakdown).filter(v => v > 0).length;
    return diversityB - diversityA;
  });

  return clusters;
}

// Convert DB articles to legacy format for clustering
function toLegacyArticles(dbArticles: { title: string; url: string; published_at: string; source_name: string; bias: BiasRating; snippet: string | null }[]): LegacyArticle[] {
  return dbArticles.map(a => ({
    title: a.title,
    link: a.url,
    pubDate: a.published_at,
    source: a.source_name,
    bias: a.bias as BiasRating,
    snippet: a.snippet || undefined
  }));
}

// Generate daily briefing
function generateBriefing(clusters: StoryCluster[]): void {
  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           📰 INFORMATION HYGIENE BRIEFING'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));

  const competingNarratives = clusters.filter(c => c.hasCompetingNarratives);

  if (competingNarratives.length === 0) {
    console.log(chalk.yellow('No stories with competing narratives found today.\n'));
    return;
  }

  console.log(chalk.white(`Found ${chalk.bold(competingNarratives.length)} stories with competing narratives:\n`));

  for (const cluster of competingNarratives.slice(0, 5)) {
    console.log(chalk.bold.white(`\n📌 ${cluster.topic.toUpperCase()}`));
    console.log(chalk.dim('─'.repeat(50)));

    const biasOrder: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right'];
    const breakdown = biasOrder
      .filter(b => cluster.biasBreakdown[b] > 0)
      .map(b => `${getBiasColor(b)}${getBiasLabel(b)}: ${cluster.biasBreakdown[b]}\x1b[0m`)
      .join('  ');
    console.log(`Coverage: ${breakdown}\n`);

    for (const bias of biasOrder) {
      const articles = cluster.articles.filter(a => a.bias === bias);
      if (articles.length > 0) {
        for (const article of articles.slice(0, 1)) {
          console.log(`${getBiasColor(bias)}  ${article.source}:\x1b[0m ${article.title}`);
        }
      }
    }
  }

  console.log('\n' + chalk.dim('─'.repeat(55)));
  console.log(chalk.cyan('\n💡 TIP: Read at least one article from each side to avoid being "half blind".\n'));
}

// Find competing narratives on a specific topic
async function findTopicNarratives(topic: string): Promise<void> {
  console.log(chalk.cyan(`\n🔍 Searching for competing narratives on: "${topic}"\n`));

  const keywords = topic.split(/\s+/);
  const dbArticles = searchArticlesByKeywords(keywords, 100);

  if (dbArticles.length === 0) {
    console.log(chalk.yellow(`No articles found matching "${topic}"`));
    console.log(chalk.dim('Try running "bun run curator" to fetch fresh articles.\n'));
    return;
  }

  console.log(chalk.green(`Found ${dbArticles.length} articles on "${topic}":\n`));

  const biasOrder: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right'];

  for (const bias of biasOrder) {
    const biasArticles = dbArticles.filter(a => a.bias === bias);
    if (biasArticles.length > 0) {
      console.log(chalk.bold(`${getBiasColor(bias)}${getBiasLabel(bias)}\x1b[0m`));
      for (const article of biasArticles.slice(0, 2)) {
        console.log(`  • ${article.title}`);
        console.log(chalk.dim(`    ${article.source_name} | ${article.url}\n`));
      }
    }
  }
}

// Show database statistics
function showStats(): void {
  const stats = getDbStats();
  const biasBreakdown = getArticleBiasBreakdown();
  const embeddingStats = getEmbeddingStats();

  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           📊 DATABASE STATISTICS'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));

  console.log(chalk.white('Total Records:'));
  console.log(`  Articles:  ${chalk.bold(stats.articles)}`);
  console.log(`  Sources:   ${chalk.bold(stats.sources)}`);
  console.log(`  Claims:    ${chalk.bold(stats.claims)}`);
  console.log(`  Readings:  ${chalk.bold(stats.readings)}`);

  console.log('\n' + chalk.white('Article Bias Distribution:'));
  const biasOrder: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right'];
  for (const bias of biasOrder) {
    const data = biasBreakdown.find(b => b.bias === bias);
    if (data) {
      const bar = '█'.repeat(Math.min(Math.floor(data.percentage / 2), 25));
      console.log(`  ${getBiasColor(bias)}${getBiasLabel(bias).padEnd(15)} ${bar} ${data.count} (${data.percentage}%)\x1b[0m`);
    }
  }

  console.log('\n' + chalk.white('Embeddings:'));
  console.log(`  With embeddings: ${embeddingStats.withEmbedding}/${embeddingStats.total} (${embeddingStats.percentage}%)`);

  console.log();
}

// Main
async function main() {
  const args = process.argv.slice(2);

  // Initialize database
  getDb();

  if (args.includes('--stats')) {
    showStats();
  } else if (args.includes('--briefing')) {
    // Generate briefing from recent articles
    const dbArticles = getRecentArticles(24, 500);
    const articles = toLegacyArticles(dbArticles);
    const clusters = clusterArticles(articles);
    generateBriefing(clusters);
  } else if (args.includes('--topic')) {
    const topicIndex = args.indexOf('--topic');
    const topic = args[topicIndex + 1];
    if (!topic) {
      console.error('Usage: --topic <search term>');
      process.exit(1);
    }
    await findTopicNarratives(topic);
  } else if (args.includes('--embeddings')) {
    // Generate embeddings for articles without them
    console.log(chalk.cyan('🧠 Generating embeddings for articles...\n'));
    const count = await generateMissingEmbeddings(100);
    console.log(chalk.green(`\n✓ Generated ${count} embeddings`));
    const stats = getEmbeddingStats();
    console.log(chalk.dim(`  Coverage: ${stats.withEmbedding}/${stats.total} (${stats.percentage}%)\n`));
  } else {
    // Default: fetch and cluster
    await fetchAllArticles();

    const dbArticles = getRecentArticles(24, 500);
    const articles = toLegacyArticles(dbArticles);
    const clusters = clusterArticles(articles);

    console.log(chalk.cyan(`\n📊 Created ${clusters.length} story clusters`));
    console.log(chalk.cyan(`   ${clusters.filter(c => c.hasCompetingNarratives).length} with competing narratives\n`));

    console.log(chalk.dim('Run with --briefing to see the daily briefing'));
    console.log(chalk.dim('Run with --topic <term> to search for a specific topic'));
    console.log(chalk.dim('Run with --stats to see database statistics'));
    console.log(chalk.dim('Run with --embeddings to generate vector embeddings\n'));
  }
}

main().catch(console.error);
