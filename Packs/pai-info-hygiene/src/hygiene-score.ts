#!/usr/bin/env bun
/**
 * Information Hygiene Score Calculator
 *
 * Calculates and displays your personal information hygiene score based on:
 * - Reading balance across political spectrum
 * - Topic diversity
 * - Opposing viewpoint exposure
 *
 * Usage:
 *   bun run src/hygiene-score.ts              # Show current hygiene score
 *   bun run src/hygiene-score.ts --record     # Record reading an article
 *   bun run src/hygiene-score.ts --history    # Show reading history
 */

import chalk from 'chalk';
import { getDb } from './db/schema';
import {
  getReadingHistory,
  getDailyHygieneScores,
  getReadingBiasBreakdown,
  recordReading,
  getArticle,
  searchArticlesByKeywords,
  getDbStats
} from './db/storage';
import { findOpposingArticles } from './db/embeddings';
import { getBiasColor, getBiasLabel, type BiasRating } from './sources';

// Score thresholds
const SCORE_EXCELLENT = 80;
const SCORE_GOOD = 60;
const SCORE_FAIR = 40;

// Get score label and color
function getScoreLabel(score: number): { label: string; color: (s: string) => string } {
  if (score >= SCORE_EXCELLENT) return { label: 'Excellent', color: chalk.green };
  if (score >= SCORE_GOOD) return { label: 'Good', color: chalk.cyan };
  if (score >= SCORE_FAIR) return { label: 'Fair', color: chalk.yellow };
  return { label: 'Needs Work', color: chalk.red };
}

// Calculate overall hygiene score
function calculateHygieneScore(): {
  overall: number;
  balanceScore: number;
  diversityScore: number;
  volumeScore: number;
  recommendations: string[];
} {
  const readings = getReadingHistory(7);
  const biasBreakdown = getReadingBiasBreakdown(7);

  // If no reading history, return default scores
  if (readings.length === 0) {
    return {
      overall: 0,
      balanceScore: 0,
      diversityScore: 0,
      volumeScore: 0,
      recommendations: [
        '📚 Start recording your reading to build your hygiene profile',
        '💡 Use "bun run score --record <url>" to track articles you read'
      ]
    };
  }

  // 1. Balance Score (0-100): How balanced is left vs right reading?
  const leftCount = biasBreakdown
    .filter(b => b.bias === 'left' || b.bias === 'lean-left')
    .reduce((sum, b) => sum + b.count, 0);
  const rightCount = biasBreakdown
    .filter(b => b.bias === 'right' || b.bias === 'lean-right')
    .reduce((sum, b) => sum + b.count, 0);
  const centerCount = biasBreakdown
    .filter(b => b.bias === 'center')
    .reduce((sum, b) => sum + b.count, 0);

  const totalPartisan = leftCount + rightCount;
  const balanceScore = totalPartisan === 0
    ? 50 // Only center articles
    : Math.round(100 - (Math.abs(leftCount - rightCount) / totalPartisan * 100));

  // 2. Diversity Score (0-100): How many different bias categories?
  const biasesRead = biasBreakdown.filter(b => b.count > 0).length;
  const diversityScore = Math.round((biasesRead / 5) * 100);

  // 3. Volume Score (0-100): Reading enough articles?
  // Target: 3+ articles per day = 21+ per week
  const targetWeeklyArticles = 21;
  const volumeScore = Math.min(100, Math.round((readings.length / targetWeeklyArticles) * 100));

  // Overall score (weighted average)
  const overall = Math.round(
    balanceScore * 0.4 +
    diversityScore * 0.35 +
    volumeScore * 0.25
  );

  // Generate recommendations
  const recommendations: string[] = [];

  if (balanceScore < 60) {
    if (leftCount > rightCount) {
      recommendations.push('⚖️ Read more right-leaning sources to balance your perspective');
    } else {
      recommendations.push('⚖️ Read more left-leaning sources to balance your perspective');
    }
  }

  if (diversityScore < 60) {
    const missingBiases: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right']
      .filter(b => !biasBreakdown.some(bd => bd.bias === b && bd.count > 0)) as BiasRating[];
    if (missingBiases.length > 0) {
      recommendations.push(`📰 Try reading from: ${missingBiases.map(b => getBiasLabel(b)).join(', ')}`);
    }
  }

  if (volumeScore < 60) {
    recommendations.push('📚 Try to read at least 3 news articles per day');
  }

  if (centerCount < (leftCount + rightCount) * 0.2) {
    recommendations.push('🎯 Include more center/neutral sources for baseline facts');
  }

  if (recommendations.length === 0) {
    recommendations.push('🌟 Great job maintaining balanced reading habits!');
  }

  return { overall, balanceScore, diversityScore, volumeScore, recommendations };
}

// Display hygiene score dashboard
function displayScore(): void {
  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           🧹 INFORMATION HYGIENE SCORE'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));

  const score = calculateHygieneScore();
  const { label, color } = getScoreLabel(score.overall);

  // Overall score display
  const scoreBar = '█'.repeat(Math.floor(score.overall / 5)) + '░'.repeat(20 - Math.floor(score.overall / 5));
  console.log(chalk.white('Overall Score:'));
  console.log(`  ${color(scoreBar)} ${color(String(score.overall) + '%')} ${color(`(${label})`)}\n`);

  // Component scores
  console.log(chalk.white('Component Scores:'));
  console.log(`  Balance:   ${getScoreBar(score.balanceScore)} ${score.balanceScore}%`);
  console.log(`  Diversity: ${getScoreBar(score.diversityScore)} ${score.diversityScore}%`);
  console.log(`  Volume:    ${getScoreBar(score.volumeScore)} ${score.volumeScore}%\n`);

  // Reading breakdown
  const biasBreakdown = getReadingBiasBreakdown(7);
  if (biasBreakdown.length > 0) {
    console.log(chalk.white('This Week\'s Reading (by source bias):'));
    const biasOrder: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right'];
    for (const bias of biasOrder) {
      const data = biasBreakdown.find(b => b.bias === bias);
      const count = data?.count || 0;
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${getBiasColor(bias)}${getBiasLabel(bias).padEnd(15)} ${bar} ${count}\x1b[0m`);
    }
    console.log();
  }

  // Daily trend
  const dailyScores = getDailyHygieneScores(7);
  if (dailyScores.length > 0) {
    console.log(chalk.white('Daily Balance Trend (last 7 days):'));
    for (const day of dailyScores.slice(0, 7)) {
      const date = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const scoreLabel = getScoreLabel(day.balance_score || 0);
      console.log(`  ${date.padEnd(15)} ${getScoreBar(day.balance_score || 0)} ${day.articles_read} articles`);
    }
    console.log();
  }

  // Recommendations
  console.log(chalk.white('Recommendations:'));
  for (const rec of score.recommendations) {
    console.log(`  ${rec}`);
  }

  console.log();
}

function getScoreBar(score: number): string {
  const filled = Math.floor(score / 10);
  const empty = 10 - filled;
  const { color } = getScoreLabel(score);
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

// Display reading history
function displayHistory(): void {
  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           📖 READING HISTORY'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));

  const readings = getReadingHistory(30);

  if (readings.length === 0) {
    console.log(chalk.yellow('No reading history found.'));
    console.log(chalk.dim('Use "bun run score --record <article-url>" to track what you read.\n'));
    return;
  }

  console.log(chalk.white(`Last ${readings.length} articles read:\n`));

  for (const reading of readings.slice(0, 20)) {
    const article = getArticle(reading.article_id);
    if (article) {
      const date = new Date(reading.read_at).toLocaleDateString();
      console.log(`${getBiasColor(reading.source_bias)}${reading.source_bias.padEnd(12)}\x1b[0m ${chalk.dim(date)} ${article.title.slice(0, 60)}...`);
    }
  }

  console.log();
}

// Record reading an article
async function recordArticleReading(urlOrSearch: string): Promise<void> {
  const db = getDb();

  // Try to find by URL first
  let article = db.query('SELECT * FROM articles WHERE url = ?').get(urlOrSearch) as any;

  // If not found, search by keywords
  if (!article) {
    const articles = searchArticlesByKeywords([urlOrSearch], 5);
    if (articles.length > 0) {
      console.log(chalk.cyan('\n📰 Found matching articles:\n'));
      articles.forEach((a, i) => {
        console.log(`  ${i + 1}. ${getBiasColor(a.bias)}[${a.bias}]\x1b[0m ${a.title.slice(0, 60)}...`);
      });

      // Use first match
      article = articles[0];
      console.log(chalk.dim(`\nRecording first match: "${article.title.slice(0, 50)}..."\n`));
    }
  }

  if (!article) {
    console.log(chalk.yellow(`Article not found: "${urlOrSearch}"`));
    console.log(chalk.dim('Try running "bun run curator" to fetch more articles.\n'));
    return;
  }

  // Record the reading
  recordReading(article.id);

  console.log(chalk.green(`\n✓ Recorded reading: "${article.title.slice(0, 50)}..."`));
  console.log(chalk.dim(`  Source: ${article.source_name} (${article.bias})\n`));

  // Suggest opposing view
  const opposingArticles = await findOpposingArticles(article.id, 3);
  if (opposingArticles.length > 0) {
    console.log(chalk.cyan('💡 For balance, consider reading:\n'));
    for (const { article: opp } of opposingArticles) {
      console.log(`  ${getBiasColor(opp.bias)}[${opp.bias}]\x1b[0m ${opp.title.slice(0, 55)}...`);
      console.log(chalk.dim(`    ${opp.url}\n`));
    }
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  // Initialize database
  getDb();

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.bold.cyan('Information Hygiene Score Calculator')}

Track your reading habits and maintain balanced information consumption.

${chalk.bold('Usage:')}
  bun run score                    Show your hygiene score
  bun run score --history          Show reading history
  bun run score --record <url>     Record reading an article
  bun run score --record <term>    Search and record by keyword

${chalk.bold('Scoring:')}
  Balance (40%):   Left vs Right reading balance
  Diversity (35%): Coverage of all bias categories
  Volume (25%):    Reading at least 3 articles/day

${chalk.bold('Score Levels:')}
  80-100%: Excellent - Well-balanced information diet
  60-79%:  Good - Generally balanced with minor gaps
  40-59%:  Fair - Some blind spots to address
  0-39%:   Needs Work - Significant imbalance

${chalk.bold('Philosophy:')}
  "If you deeply believe something and are completely unaware of the
   competing narrative, you are half blind."
`);
    return;
  }

  if (args.includes('--history')) {
    displayHistory();
  } else if (args.includes('--record')) {
    const recordIndex = args.indexOf('--record');
    const urlOrSearch = args.slice(recordIndex + 1).join(' ');
    if (!urlOrSearch) {
      console.error('Usage: bun run score --record <url or search term>');
      process.exit(1);
    }
    await recordArticleReading(urlOrSearch);
  } else {
    displayScore();
  }
}

main().catch(console.error);
