#!/usr/bin/env bun
/**
 * Narrative Pattern Analyzer
 *
 * Expands beyond single-topic analysis to uncover meta-patterns across
 * related threads. Identifies:
 *
 * 1. Source Consistency - Does outlet X always frame stories one way?
 * 2. Narrative Clusters - Which topics get grouped together?
 * 3. Frame Recycling - Same rhetorical patterns across different stories
 * 4. Wedge Detection - Topics that consistently split coverage
 * 5. Actor Networks - Who appears across multiple stories and how?
 *
 * Usage:
 *   bun run src/pattern-analyzer.ts --cluster "musk,tesla,doge,spacex"
 *   bun run src/pattern-analyzer.ts --actor "Elon Musk"
 *   bun run src/pattern-analyzer.ts --source-bias "Fox News"
 */

import { writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { NEWS_SOURCES, getBiasColor, getBiasLabel, type BiasRating } from './sources';
import { getDb, type Article as DbArticle } from './db/schema';
import { getRecentArticles, searchArticlesByKeywords, getDbStats } from './db/storage';

// Configuration
const CACHE_DIR = join(homedir(), '.cache', 'pai-info-hygiene');
const PATTERNS_CACHE = join(CACHE_DIR, 'patterns.json');

// Types
interface Article {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  bias: BiasRating;
  snippet?: string;
}

interface TopicCoverage {
  topic: string;
  articles: Article[];
  biasBreakdown: Record<BiasRating, number>;
  dominantFrame?: string;
}

interface SourcePattern {
  source: string;
  bias: BiasRating;
  topicsCovered: string[];
  framingConsistency: 'consistent' | 'mixed' | 'varied';
  commonKeywords: string[];
}

interface NarrativeCluster {
  name: string;
  topics: string[];
  sharedActors: string[];
  leftFrame: string;
  rightFrame: string;
  bridgeTopics: string[]; // Topics where left and right somewhat agree
  wedgeTopics: string[];  // Topics with maximum disagreement
}

interface PatternAnalysis {
  timestamp: number;
  topics: TopicCoverage[];
  sourcePatterns: SourcePattern[];
  clusters: NarrativeCluster[];
  metaInsights: string[];
}

// Known actors and entities for detection
const KNOWN_ACTORS = [
  'Elon Musk', 'Musk', 'Trump', 'Biden', 'Vivek Ramaswamy', 'Ramaswamy',
  'Tesla', 'SpaceX', 'Starlink', 'DOGE', 'X', 'Twitter',
  'BYD', 'Rivian', 'Ford', 'GM', 'Apple', 'Google', 'Meta',
  'Republicans', 'Democrats', 'MAGA', 'GOP', 'DNC'
];

// Common framing keywords by bias
const FRAMING_KEYWORDS: Record<BiasRating, string[]> = {
  'left': ['controversial', 'backlash', 'critics say', 'concerns', 'troubling', 'alarming', 'far-right'],
  'lean-left': ['raises questions', 'faces criticism', 'scrutiny', 'challenges', 'tensions'],
  'center': ['amid', 'according to', 'reports', 'sources say', 'developments'],
  'lean-right': ['pushback', 'mainstream media', 'elites', 'establishment', 'woke'],
  'right': ['radical', 'leftist', 'liberal', 'mainstream media lies', 'truth', 'freedom', 'patriot']
};

// Search articles for topic
function searchArticles(topic: string, articles: Article[]): Article[] {
  const topicLower = topic.toLowerCase();
  const keywords = topicLower.split(/[\s,]+/).filter(k => k.length > 2);

  return articles.filter(a => {
    const titleLower = a.title.toLowerCase();
    const snippetLower = (a.snippet || '').toLowerCase();
    return keywords.some(k => titleLower.includes(k) || snippetLower.includes(k));
  });
}

// Extract actors mentioned in article
function extractActors(article: Article): string[] {
  const text = `${article.title} ${article.snippet || ''}`;
  return KNOWN_ACTORS.filter(actor =>
    text.toLowerCase().includes(actor.toLowerCase())
  );
}

// Detect framing keywords in article
function detectFraming(article: Article): string[] {
  const text = `${article.title} ${article.snippet || ''}`.toLowerCase();
  const detected: string[] = [];

  for (const [bias, keywords] of Object.entries(FRAMING_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        detected.push(`[${bias}] ${keyword}`);
      }
    }
  }

  return detected;
}

// Analyze coverage for a single topic
function analyzeTopicCoverage(topic: string, articles: Article[]): TopicCoverage {
  const topicArticles = searchArticles(topic, articles);

  const biasBreakdown: Record<BiasRating, number> = {
    'left': 0, 'lean-left': 0, 'center': 0, 'lean-right': 0, 'right': 0
  };

  topicArticles.forEach(a => biasBreakdown[a.bias]++);

  // Determine dominant frame based on coverage weight
  const leftWeight = biasBreakdown['left'] * 2 + biasBreakdown['lean-left'];
  const rightWeight = biasBreakdown['right'] * 2 + biasBreakdown['lean-right'];

  let dominantFrame: string;
  if (leftWeight > rightWeight * 1.5) dominantFrame = 'Left-dominated';
  else if (rightWeight > leftWeight * 1.5) dominantFrame = 'Right-dominated';
  else dominantFrame = 'Balanced';

  return { topic, articles: topicArticles, biasBreakdown, dominantFrame };
}

// Analyze patterns for a source
function analyzeSourcePattern(sourceName: string, articles: Article[], topics: string[]): SourcePattern {
  const source = NEWS_SOURCES.find(s => s.name === sourceName);
  if (!source) {
    return {
      source: sourceName,
      bias: 'center',
      topicsCovered: [],
      framingConsistency: 'mixed',
      commonKeywords: []
    };
  }

  const sourceArticles = articles.filter(a => a.source === sourceName);
  const topicsCovered = topics.filter(t =>
    searchArticles(t, sourceArticles).length > 0
  );

  // Analyze framing consistency
  const allFraming = sourceArticles.flatMap(detectFraming);
  const framingBiases = allFraming.map(f => f.match(/\[(\w+(-\w+)?)\]/)?.[1]).filter(Boolean);
  const uniqueBiases = new Set(framingBiases);

  const framingConsistency = uniqueBiases.size <= 1 ? 'consistent' :
                             uniqueBiases.size <= 2 ? 'mixed' : 'varied';

  // Find common keywords
  const allText = sourceArticles.map(a => `${a.title} ${a.snippet || ''}`).join(' ').toLowerCase();
  const wordFreq: Record<string, number> = {};
  allText.split(/\s+/).forEach(word => {
    if (word.length > 4) wordFreq[word] = (wordFreq[word] || 0) + 1;
  });

  const commonKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return {
    source: sourceName,
    bias: source.bias,
    topicsCovered,
    framingConsistency,
    commonKeywords
  };
}

// Build narrative cluster from related topics
function buildNarrativeCluster(
  name: string,
  topics: string[],
  articles: Article[]
): NarrativeCluster {
  // Find actors that appear across multiple topics
  const actorCounts: Record<string, number> = {};

  for (const topic of topics) {
    const topicArticles = searchArticles(topic, articles);
    const topicActors = new Set(topicArticles.flatMap(extractActors));
    topicActors.forEach(actor => {
      actorCounts[actor] = (actorCounts[actor] || 0) + 1;
    });
  }

  const sharedActors = Object.entries(actorCounts)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([actor]) => actor);

  // Analyze left vs right framing per topic
  const topicFrames: { topic: string; leftCount: number; rightCount: number }[] = [];

  for (const topic of topics) {
    const topicArticles = searchArticles(topic, articles);
    const leftCount = topicArticles.filter(a =>
      a.bias === 'left' || a.bias === 'lean-left'
    ).length;
    const rightCount = topicArticles.filter(a =>
      a.bias === 'right' || a.bias === 'lean-right'
    ).length;
    topicFrames.push({ topic, leftCount, rightCount });
  }

  // Identify wedge topics (high disagreement) vs bridge topics (similar coverage)
  const wedgeTopics: string[] = [];
  const bridgeTopics: string[] = [];

  for (const { topic, leftCount, rightCount } of topicFrames) {
    const total = leftCount + rightCount;
    if (total === 0) continue;

    const imbalance = Math.abs(leftCount - rightCount) / total;
    if (imbalance < 0.3) bridgeTopics.push(topic);
    else if (imbalance > 0.6) wedgeTopics.push(topic);
  }

  // Summarize frames (simplified - would use AI in production)
  const leftArticles = articles.filter(a =>
    a.bias === 'left' || a.bias === 'lean-left'
  );
  const rightArticles = articles.filter(a =>
    a.bias === 'right' || a.bias === 'lean-right'
  );

  const leftFrame = summarizeFrame(topics, leftArticles);
  const rightFrame = summarizeFrame(topics, rightArticles);

  return {
    name,
    topics,
    sharedActors,
    leftFrame,
    rightFrame,
    bridgeTopics,
    wedgeTopics
  };
}

// Summarize frame from articles (simplified version)
function summarizeFrame(topics: string[], articles: Article[]): string {
  const relevantArticles = articles.filter(a =>
    topics.some(t => searchArticles(t, [a]).length > 0)
  );

  if (relevantArticles.length === 0) return 'No coverage';

  // Extract most common framing keywords
  const framingKeywords = relevantArticles.flatMap(detectFraming);
  const keywordCounts: Record<string, number> = {};
  framingKeywords.forEach(k => {
    keywordCounts[k] = (keywordCounts[k] || 0) + 1;
  });

  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k.replace(/\[\w+(-\w+)?\]\s*/, ''));

  if (topKeywords.length === 0) return 'Neutral framing';
  return `Emphasizes: ${topKeywords.join(', ')}`;
}

// Generate meta-insights from analysis
function generateMetaInsights(
  topics: TopicCoverage[],
  sourcePatterns: SourcePattern[],
  cluster: NarrativeCluster
): string[] {
  const insights: string[] = [];

  // Coverage imbalance
  const imbalancedTopics = topics.filter(t => t.dominantFrame !== 'Balanced');
  if (imbalancedTopics.length > topics.length / 2) {
    insights.push(`⚠️ ${imbalancedTopics.length}/${topics.length} topics have imbalanced coverage`);
  }

  // Shared actors
  if (cluster.sharedActors.length > 0) {
    insights.push(`🔗 Key actors across topics: ${cluster.sharedActors.slice(0, 3).join(', ')}`);
  }

  // Wedge vs bridge
  if (cluster.wedgeTopics.length > 0) {
    insights.push(`🔥 High-conflict topics: ${cluster.wedgeTopics.join(', ')}`);
  }
  if (cluster.bridgeTopics.length > 0) {
    insights.push(`🌉 Cross-partisan topics: ${cluster.bridgeTopics.join(', ')}`);
  }

  // Source consistency
  const consistentSources = sourcePatterns.filter(s => s.framingConsistency === 'consistent');
  if (consistentSources.length > sourcePatterns.length * 0.6) {
    insights.push(`📊 Most sources maintain consistent framing across topics`);
  }

  // Coverage gaps
  const uncoveredByLeft = topics.filter(t =>
    t.biasBreakdown['left'] + t.biasBreakdown['lean-left'] === 0
  );
  const uncoveredByRight = topics.filter(t =>
    t.biasBreakdown['right'] + t.biasBreakdown['lean-right'] === 0
  );

  if (uncoveredByLeft.length > 0) {
    insights.push(`📭 Left ignoring: ${uncoveredByLeft.map(t => t.topic).join(', ')}`);
  }
  if (uncoveredByRight.length > 0) {
    insights.push(`📭 Right ignoring: ${uncoveredByRight.map(t => t.topic).join(', ')}`);
  }

  return insights;
}

// Display pattern analysis
function displayAnalysis(analysis: PatternAnalysis): void {
  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           🔬 NARRATIVE PATTERN ANALYSIS'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));

  // Topic coverage summary
  console.log(chalk.bold.white('📊 TOPIC COVERAGE MATRIX\n'));
  console.log(chalk.dim('Topic'.padEnd(20) + 'L  LL  C  LR  R  Frame'));
  console.log(chalk.dim('─'.repeat(55)));

  for (const topic of analysis.topics) {
    const { biasBreakdown: b, dominantFrame } = topic;
    const row = topic.topic.slice(0, 18).padEnd(20) +
      String(b['left']).padStart(2) + '  ' +
      String(b['lean-left']).padStart(2) + '  ' +
      String(b['center']).padStart(2) + '  ' +
      String(b['lean-right']).padStart(2) + '  ' +
      String(b['right']).padStart(2) + '  ' +
      dominantFrame;
    console.log(row);
  }

  // Cluster analysis
  if (analysis.clusters.length > 0) {
    const cluster = analysis.clusters[0];

    console.log('\n' + chalk.bold.white('🔗 NARRATIVE CLUSTER: ' + cluster.name + '\n'));

    if (cluster.sharedActors.length > 0) {
      console.log(chalk.white('Shared actors: ') + chalk.yellow(cluster.sharedActors.join(', ')));
    }

    console.log('\n' + chalk.blue('◀ LEFT FRAME: ') + cluster.leftFrame);
    console.log(chalk.red('RIGHT FRAME ▶: ') + cluster.rightFrame);

    if (cluster.wedgeTopics.length > 0) {
      console.log(chalk.magenta('\n🔥 Wedge topics: ') + cluster.wedgeTopics.join(', '));
    }
    if (cluster.bridgeTopics.length > 0) {
      console.log(chalk.green('🌉 Bridge topics: ') + cluster.bridgeTopics.join(', '));
    }
  }

  // Meta-insights
  if (analysis.metaInsights.length > 0) {
    console.log('\n' + chalk.bold.white('💡 META-INSIGHTS\n'));
    for (const insight of analysis.metaInsights) {
      console.log('  ' + insight);
    }
  }

  console.log('\n' + chalk.dim('─'.repeat(55)));
}

// Convert DB articles to internal format
function toInternalArticles(dbArticles: DbArticle[]): Article[] {
  return dbArticles.map(a => ({
    title: a.title,
    link: a.url,
    pubDate: a.published_at,
    source: a.source_name,
    bias: a.bias as BiasRating,
    snippet: a.snippet || undefined
  }));
}

// Main analysis function
async function analyzePatterns(
  topicsString: string,
  clusterName?: string
): Promise<PatternAnalysis> {
  // Initialize database
  getDb();

  const stats = getDbStats();
  if (stats.articles === 0) {
    console.log(chalk.yellow('No articles in database. Run "bun run curator" first.'));
    process.exit(1);
  }

  // Get recent articles from database
  const dbArticles = getRecentArticles(72, 500); // Last 3 days
  const articles = toInternalArticles(dbArticles);

  console.log(chalk.cyan(`\n🔬 Analyzing patterns across topics...\n`));
  console.log(chalk.dim(`Using ${articles.length} articles from database (last 72 hours)\n`));

  // Parse topics
  const topics = topicsString.split(',').map(t => t.trim()).filter(Boolean);
  console.log(chalk.white(`Topics: ${topics.join(', ')}\n`));

  // Analyze each topic
  const topicCoverages = topics.map(t => analyzeTopicCoverage(t, articles));

  // Analyze source patterns
  const sourcePatterns = NEWS_SOURCES.map(s =>
    analyzeSourcePattern(s.name, articles, topics)
  ).filter(s => s.topicsCovered.length > 0);

  // Build narrative cluster
  const cluster = buildNarrativeCluster(
    clusterName || topics.slice(0, 3).join('/'),
    topics,
    articles
  );

  // Generate meta-insights
  const metaInsights = generateMetaInsights(topicCoverages, sourcePatterns, cluster);

  const analysis: PatternAnalysis = {
    timestamp: Date.now(),
    topics: topicCoverages,
    sourcePatterns,
    clusters: [cluster],
    metaInsights
  };

  // Cache results
  writeFileSync(PATTERNS_CACHE, JSON.stringify(analysis, null, 2));

  return analysis;
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
${chalk.bold.cyan('Narrative Pattern Analyzer')}

Uncover meta-patterns across related topics.

${chalk.bold('Usage:')}
  bun run src/pattern-analyzer.ts --cluster "topic1,topic2,topic3"
  bun run src/pattern-analyzer.ts --cluster "musk,tesla,doge,spacex" --name "Musk Empire"

${chalk.bold('What it reveals:')}
  • Coverage matrix - which outlets cover which topics
  • Shared actors - people/entities that span multiple stories
  • Wedge topics - maximum left/right disagreement
  • Bridge topics - potential common ground
  • Framing patterns - consistent rhetoric across stories

${chalk.bold('Examples:')}
  bun run pattern "musk,tesla,doge,x,spacex"
  bun run pattern "trump,immigration,border,h1b"
  bun run pattern "ai,openai,anthropic,google,regulation"
`);
    return;
  }

  // Parse arguments
  let topicsString = '';
  let clusterName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cluster' && args[i + 1]) {
      topicsString = args[i + 1];
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      clusterName = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      topicsString = args[i];
    }
  }

  if (!topicsString) {
    console.log(chalk.red('Please provide topics to analyze.'));
    return;
  }

  const analysis = await analyzePatterns(topicsString, clusterName);
  displayAnalysis(analysis);
}

main().catch(console.error);
