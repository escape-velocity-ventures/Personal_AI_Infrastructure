#!/usr/bin/env bun
/**
 * Single-URL Article Bias Analyzer
 *
 * Fetches an article by URL and runs the full bias analysis pipeline:
 * content type classification, emotional language scoring, loaded term
 * detection, and source counting.
 *
 * Usage:
 *   bun run analyze-url https://apnews.com/article/example
 *   bun run src/analyze-url.ts https://example.com/article
 */

import { analyzeArticle } from './analysis/classifier';
import { NEWS_SOURCES, getBiasLabel, type BiasRating } from './sources';
import { TECH_SOURCES } from './sources-tech';
import { AUTO_SOURCES } from './sources-auto';
import { ENERGY_SOURCES } from './sources-energy';
import { FACTCHECK_SOURCES } from './sources-factcheck';
import { POLICY_SOURCES } from './sources-policy';

// ── Source registry: hostname → { name, bias } ──────────────────────────

interface KnownSource {
  name: string;
  bias: BiasRating;
}

const SOURCE_REGISTRY = new Map<string, KnownSource>();

function addToRegistry(website: string, name: string, bias: BiasRating) {
  // Normalize: strip leading www., store bare domain
  const domain = website.replace(/^www\./, '').toLowerCase();
  SOURCE_REGISTRY.set(domain, { name, bias });
}

for (const s of NEWS_SOURCES) addToRegistry(s.website, s.name, s.bias);
for (const s of TECH_SOURCES) addToRegistry(s.website, s.name, s.bias);
for (const s of AUTO_SOURCES) addToRegistry(s.website, s.name, s.bias);
for (const s of ENERGY_SOURCES) addToRegistry(s.website, s.name, s.bias);
for (const s of FACTCHECK_SOURCES) addToRegistry(s.website, s.name, s.bias);
for (const s of POLICY_SOURCES) addToRegistry(s.website, s.name, s.bias);

function lookupSource(url: string): KnownSource | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    // Exact match first
    if (SOURCE_REGISTRY.has(hostname)) return SOURCE_REGISTRY.get(hostname)!;
    // Try parent domain (e.g. "news.bbc.com" → "bbc.com")
    const parts = hostname.split('.');
    if (parts.length > 2) {
      const parent = parts.slice(-2).join('.');
      if (SOURCE_REGISTRY.has(parent)) return SOURCE_REGISTRY.get(parent)!;
    }
    return null;
  } catch {
    return null;
  }
}

function inferSourceName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Capitalize domain parts: "nytimes.com" → "Nytimes"
    return hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);
  } catch {
    return 'Unknown';
  }
}

// ── HTML extraction ─────────────────────────────────────────────────────

function extractTitle(html: string): string {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/si);
  if (titleMatch) return decodeEntities(titleMatch[1].trim());
  // Try og:title
  const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) return decodeEntities(ogMatch[1].trim());
  return 'Untitled';
}

function extractText(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = decodeEntities(text);
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ── Display ─────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const WHITE = '\x1b[37m';

function biasColor(bias: BiasRating): string {
  const colors: Record<BiasRating, string> = {
    'left': BLUE,
    'lean-left': CYAN,
    'center': WHITE,
    'lean-right': MAGENTA,
    'right': RED,
  };
  return colors[bias];
}

function biasArrow(bias: 'left' | 'right' | 'sensational'): string {
  if (bias === 'left') return `${BLUE}\u25C0${RESET}`;     // ◀
  if (bias === 'right') return `${RED}\u25B6${RESET}`;     // ▶
  return `${YELLOW}\u26A1${RESET}`;                         // ⚡
}

function emotionalBar(score: number): string {
  const filled = Math.round(score * 10);
  const empty = 10 - filled;
  const color = score < 0.3 ? GREEN : score < 0.6 ? YELLOW : RED;
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

function printResults(url: string, sourceName: string, sourceBias: string, title: string, result: ReturnType<typeof analyzeArticle>) {
  console.log();
  console.log(`${BOLD}📰 ARTICLE BIAS ANALYSIS${RESET}`);
  console.log('═'.repeat(50));
  console.log(`${DIM}URL:${RESET}     ${url}`);
  console.log(`${DIM}Source:${RESET}  ${sourceName} (${sourceBias})`);
  console.log(`${DIM}Title:${RESET}   ${title.slice(0, 80)}${title.length > 80 ? '...' : ''}`);
  console.log();

  // Content type
  const confidence = Math.round(result.contentTypeConfidence * 100);
  console.log(`📊 ${BOLD}Content Type:${RESET}  ${result.contentType} (${confidence}% confidence)`);

  // Emotional score
  console.log(`🔥 ${BOLD}Emotional Score:${RESET} ${result.emotionalLanguageScore.toFixed(2)} ${emotionalBar(result.emotionalLanguageScore)}`);
  console.log();

  // Loaded terms
  if (result.loadedTerms.length > 0) {
    console.log(`📝 ${BOLD}Loaded Terms (${result.loadedTerms.length} found):${RESET}`);
    for (const lt of result.loadedTerms) {
      console.log(`  ${biasArrow(lt.bias)} "${lt.term}" → "${lt.neutralAlternative}" (${lt.bias})`);
    }
  } else {
    console.log(`📝 ${BOLD}Loaded Terms:${RESET} ${GREEN}None detected${RESET}`);
  }
  console.log();

  // Sources
  console.log(`👤 ${BOLD}Sources:${RESET} ${result.namedSourceCount} named, ${result.anonymousSourceCount} anonymous`);
  console.log(`📌 ${BOLD}Primary source:${RESET} ${result.isPrimarySource ? 'Yes' : 'No'}`);
  console.log();

  // All signals
  if (result.allSignals.length > 0) {
    console.log(`🔍 ${BOLD}All Signals:${RESET}`);
    for (const signal of result.allSignals) {
      console.log(`  ${DIM}-${RESET} ${signal}`);
    }
  }

  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const url = process.argv[2];

  if (!url || url === '--help' || url === '-h') {
    console.log('Usage: bun run analyze-url <URL>');
    console.log();
    console.log('Fetches an article and runs bias analysis:');
    console.log('  - Content type classification (wire/reporting/analysis/opinion/editorial)');
    console.log('  - Emotional language scoring (0-1 scale)');
    console.log('  - Loaded term detection (942 terms, left/right/sensational)');
    console.log('  - Named vs anonymous source counting');
    console.log('  - Primary source detection');
    console.log();
    console.log('Examples:');
    console.log('  bun run analyze-url https://apnews.com/article/example');
    console.log('  bun run analyze-url https://www.foxnews.com/opinion/some-article');
    process.exit(0);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Error: Invalid URL "${url}"`);
    process.exit(1);
  }

  // Look up source
  const known = lookupSource(url);
  const sourceName = known?.name ?? inferSourceName(url);
  const sourceBias = known?.bias ?? 'center';
  const biasLabel = getBiasLabel(sourceBias);

  // Fetch
  console.log(`${DIM}Fetching ${url}...${RESET}`);
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.error(`Error: HTTP ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    html = await response.text();
  } catch (error: any) {
    console.error(`Error fetching URL: ${error.message}`);
    process.exit(1);
  }

  // Extract
  const title = extractTitle(html);
  const text = extractText(html);

  if (text.length < 50) {
    console.error('Warning: Very little text extracted. The site may require JavaScript rendering.');
    console.error(`Extracted ${text.length} characters. Proceeding with available text.`);
  }

  // Analyze
  const result = analyzeArticle(url, sourceName, title, text);

  // Display
  printResults(url, sourceName, biasLabel, title, result);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
