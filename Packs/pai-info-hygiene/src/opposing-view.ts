#!/usr/bin/env bun
/**
 * Opposing View Agent
 *
 * For any topic you're researching, this agent:
 * 1. Detects your apparent position based on sources you're consuming
 * 2. Finds the strongest opposing arguments
 * 3. Uses Fabric's analyze_claims to provide balanced analysis
 * 4. Generates a "steelman" of the opposing position
 *
 * Usage:
 *   bun run src/opposing-view.ts <topic>
 *   bun run src/opposing-view.ts "immigration policy" --position left
 *   bun run src/opposing-view.ts "gun control" --steelman
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { NEWS_SOURCES, getBiasLabel, getBiasColor, type BiasRating } from './sources';

// Configuration
const CACHE_DIR = join(homedir(), '.cache', 'pai-info-hygiene');
const ARTICLES_CACHE = join(CACHE_DIR, 'articles.json');

// Types
interface Article {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  bias: BiasRating;
  snippet?: string;
}

interface OpposingViewResult {
  topic: string;
  userPosition: 'left' | 'right' | 'unknown';
  opposingPosition: 'left' | 'right';
  strongestArguments: Article[];
  steelmanSummary?: string;
  claimAnalysis?: string;
}

// Get opposing sources based on position
function getOpposingSources(position: 'left' | 'right'): string[] {
  if (position === 'left') {
    // User leans left, show right sources
    return NEWS_SOURCES
      .filter(s => s.bias === 'right' || s.bias === 'lean-right')
      .map(s => s.name);
  } else {
    // User leans right, show left sources
    return NEWS_SOURCES
      .filter(s => s.bias === 'left' || s.bias === 'lean-left')
      .map(s => s.name);
  }
}

// Search cached articles for topic
function searchArticles(topic: string): Article[] {
  if (!existsSync(ARTICLES_CACHE)) {
    console.log(chalk.yellow('No cached articles. Run "bun run curator" first.'));
    return [];
  }

  const cached = JSON.parse(readFileSync(ARTICLES_CACHE, 'utf-8'));
  const articles: Article[] = cached.data;

  const topicLower = topic.toLowerCase();
  const keywords = topicLower.split(/\s+/);

  return articles.filter(a => {
    const titleLower = a.title.toLowerCase();
    const snippetLower = (a.snippet || '').toLowerCase();

    // Match if any keyword appears
    return keywords.some(k =>
      titleLower.includes(k) || snippetLower.includes(k)
    );
  });
}

// Infer user's position based on which sources they might be reading
function inferPosition(articles: Article[]): 'left' | 'right' | 'unknown' {
  let leftScore = 0;
  let rightScore = 0;

  for (const article of articles) {
    if (article.bias === 'left') leftScore += 2;
    else if (article.bias === 'lean-left') leftScore += 1;
    else if (article.bias === 'right') rightScore += 2;
    else if (article.bias === 'lean-right') rightScore += 1;
  }

  if (leftScore > rightScore * 1.5) return 'left';
  if (rightScore > leftScore * 1.5) return 'right';
  return 'unknown';
}

// Run Fabric analyze_claims on content
async function analyzeClaimsWithFabric(content: string): Promise<string> {
  try {
    const result = execSync(
      `echo "${content.replace(/"/g, '\\"').replace(/\n/g, ' ')}" | fabric-ai -p analyze_claims`,
      {
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return result;
  } catch (error) {
    console.log(chalk.dim('  (Fabric analysis unavailable)'));
    return '';
  }
}

// Generate a steelman argument
async function generateSteelman(topic: string, opposingArticles: Article[]): Promise<string> {
  const headlines = opposingArticles.slice(0, 5).map(a => `- ${a.source}: ${a.title}`).join('\n');
  const snippets = opposingArticles.slice(0, 3).map(a => a.snippet || '').filter(Boolean).join(' ');

  // Build a comprehensive prompt for Fabric's AI pattern
  const content = `TOPIC: ${topic}

HEADLINES FROM THIS PERSPECTIVE:
${headlines}

CONTEXT:
${snippets.slice(0, 500)}

TASK: Present the strongest, most charitable version of the argument these sources are making. Write as an advocate, not a critic. 2-3 paragraphs.`;

  try {
    // Use the 'ai' pattern which is a general-purpose prompt
    const result = execSync(
      `echo "${content.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\$/g, '\\$')}" | fabric-ai -p ai`,
      {
        encoding: 'utf-8',
        timeout: 90000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return result.trim();
  } catch (error) {
    // Fallback: generate formatted summary
    console.log(chalk.dim('  (AI steelman unavailable, showing summary)'));
    return `${chalk.bold('Strongest opposing arguments on "' + topic + '":')}

${headlines}

${chalk.dim('To get a full steelman analysis, ensure Fabric is configured with an API key.')}`;
  }
}

// Main opposing view function
async function findOpposingView(
  topic: string,
  userPosition?: 'left' | 'right',
  includeSteelman: boolean = false
): Promise<OpposingViewResult> {
  console.log(chalk.cyan(`\n🔍 Finding opposing views on: "${topic}"\n`));

  // Search for articles on this topic
  const allArticles = searchArticles(topic);

  if (allArticles.length === 0) {
    console.log(chalk.yellow('No articles found on this topic in cache.'));
    console.log(chalk.dim('Try running "bun run curator" to fetch fresh articles.\n'));
    return {
      topic,
      userPosition: userPosition || 'unknown',
      opposingPosition: userPosition === 'left' ? 'right' : 'left',
      strongestArguments: []
    };
  }

  console.log(chalk.dim(`Found ${allArticles.length} articles on "${topic}"\n`));

  // Determine user position
  const position = userPosition || inferPosition(allArticles);
  const opposingPosition = position === 'left' ? 'right' : 'left';

  console.log(chalk.white(`Your apparent position: ${position === 'unknown' ? 'balanced/unknown' : position}`));
  console.log(chalk.white(`Showing opposing view from: ${opposingPosition}\n`));

  // Get opposing articles
  const opposingBiases: BiasRating[] = opposingPosition === 'right'
    ? ['right', 'lean-right']
    : ['left', 'lean-left'];

  const opposingArticles = allArticles.filter(a => opposingBiases.includes(a.bias));

  if (opposingArticles.length === 0) {
    console.log(chalk.yellow(`No ${opposingPosition}-leaning articles found on this topic.`));

    // Show what we do have
    const centerArticles = allArticles.filter(a => a.bias === 'center');
    if (centerArticles.length > 0) {
      console.log(chalk.dim('\nCenter sources available:'));
      for (const article of centerArticles.slice(0, 3)) {
        console.log(chalk.dim(`  • ${article.title}`));
      }
    }

    return {
      topic,
      userPosition: position,
      opposingPosition,
      strongestArguments: []
    };
  }

  // Display opposing arguments
  console.log(chalk.bold.white('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.white(`  📢 OPPOSING VIEW: What the ${opposingPosition.toUpperCase()} is saying`));
  console.log(chalk.bold.white('═══════════════════════════════════════════════════════\n'));

  for (const article of opposingArticles.slice(0, 5)) {
    console.log(`${getBiasColor(article.bias)}${article.source}:\x1b[0m`);
    console.log(`  ${article.title}`);
    if (article.snippet) {
      console.log(chalk.dim(`  ${article.snippet.slice(0, 150)}...`));
    }
    console.log(chalk.dim(`  ${article.link}\n`));
  }

  // Generate steelman if requested
  let steelmanSummary: string | undefined;
  if (includeSteelman) {
    console.log(chalk.cyan('\n🎯 Generating steelman argument...\n'));
    steelmanSummary = await generateSteelman(topic, opposingArticles);

    console.log(chalk.bold.white('═══════════════════════════════════════════════════════'));
    console.log(chalk.bold.white('  🎯 STEELMAN: Their strongest argument'));
    console.log(chalk.bold.white('═══════════════════════════════════════════════════════\n'));
    console.log(steelmanSummary);
  }

  // Offer claim analysis
  console.log(chalk.dim('\n───────────────────────────────────────────────────────'));
  console.log(chalk.cyan('\n💡 To analyze specific claims, run:'));
  console.log(chalk.dim(`   echo "<claim text>" | fabric-ai -p analyze_claims\n`));

  return {
    topic,
    userPosition: position,
    opposingPosition,
    strongestArguments: opposingArticles.slice(0, 5),
    steelmanSummary
  };
}

// Display bias spectrum for topic
function displayBiasSpectrum(topic: string): void {
  const articles = searchArticles(topic);

  if (articles.length === 0) {
    console.log(chalk.yellow('No articles found.'));
    return;
  }

  console.log(chalk.bold.cyan(`\n📊 Coverage Spectrum for "${topic}"\n`));

  const biasOrder: BiasRating[] = ['left', 'lean-left', 'center', 'lean-right', 'right'];

  for (const bias of biasOrder) {
    const biasArticles = articles.filter(a => a.bias === bias);
    const bar = '█'.repeat(Math.min(biasArticles.length, 20));
    const label = getBiasLabel(bias).padEnd(15);

    console.log(`${getBiasColor(bias)}${label} ${bar} ${biasArticles.length}\x1b[0m`);
  }

  // Calculate balance score
  const leftCount = articles.filter(a => a.bias === 'left' || a.bias === 'lean-left').length;
  const rightCount = articles.filter(a => a.bias === 'right' || a.bias === 'lean-right').length;
  const total = leftCount + rightCount;

  if (total > 0) {
    const balance = Math.abs(leftCount - rightCount) / total;
    const balanceLabel = balance < 0.2 ? '✓ Balanced' :
                         balance < 0.5 ? '⚠ Leaning' :
                         '⚠ One-sided';
    console.log(chalk.dim(`\nCoverage balance: ${balanceLabel}`));
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
${chalk.bold.cyan('Opposing View Agent')}

Find the strongest arguments from the other side of any topic.

${chalk.bold('Usage:')}
  bun run src/opposing-view.ts <topic>                    Search for opposing views
  bun run src/opposing-view.ts <topic> --position left    Specify your position
  bun run src/opposing-view.ts <topic> --steelman         Generate steelman argument
  bun run src/opposing-view.ts <topic> --spectrum         Show bias coverage spectrum

${chalk.bold('Examples:')}
  bun run src/opposing-view.ts "immigration"
  bun run src/opposing-view.ts "climate change" --position right --steelman
  bun run src/opposing-view.ts "gun control" --spectrum

${chalk.bold('Philosophy:')}
  "If you deeply believe something and are completely unaware of the
   competing narrative, you are half blind."
`);
    return;
  }

  // Parse arguments
  const topicParts: string[] = [];
  let userPosition: 'left' | 'right' | undefined;
  let includeSteelman = false;
  let showSpectrum = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--position' && args[i + 1]) {
      userPosition = args[i + 1] as 'left' | 'right';
      i++;
    } else if (args[i] === '--steelman') {
      includeSteelman = true;
    } else if (args[i] === '--spectrum') {
      showSpectrum = true;
    } else if (!args[i].startsWith('--')) {
      topicParts.push(args[i]);
    }
  }

  const topic = topicParts.join(' ');

  if (!topic) {
    console.log(chalk.red('Please provide a topic to search.'));
    return;
  }

  if (showSpectrum) {
    displayBiasSpectrum(topic);
  } else {
    await findOpposingView(topic, userPosition, includeSteelman);
  }
}

main().catch(console.error);
