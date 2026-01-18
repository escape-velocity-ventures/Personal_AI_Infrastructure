#!/usr/bin/env bun
/**
 * Analysis CLI - Fact vs Narrative Breakdown
 *
 * Usage:
 *   bun run src/analysis/cli.ts classify    - Classify articles by content type
 *   bun run src/analysis/cli.ts stats       - Show content type statistics
 *   bun run src/analysis/cli.ts narrative   - Show narrative/emotional analysis
 *   bun run src/analysis/cli.ts triangulate <topic> - Cross-source comparison
 *   bun run src/analysis/cli.ts wire        - Show wire service coverage
 *   bun run src/analysis/cli.ts neutralize  - Show neutralized headlines
 *   bun run src/analysis/cli.ts sources     - Show loaded term usage by source
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { analyzeArticle } from './classifier';
import { analyzeTopicCoverage, displayTriangulation } from './triangulate';
import { LOADED_TERMS } from './types';
import type { BiasRating, ContentType } from '../db/schema';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');

interface ArticleRow {
  id: string;
  url: string;
  title: string;
  content: string | null;
  snippet: string | null;
  source_name: string;
  bias: BiasRating;
  published_at: string;
  content_type: ContentType | null;
  emotional_language_score: number | null;
  loaded_terms: string | null;
}

/**
 * Classify unclassified articles
 */
async function classifyArticles(limit: number = 100) {
  const db = new Database(dbPath);

  // Get unclassified articles
  const articles = db.query(`
    SELECT id, url, title, content, snippet, source_name, bias
    FROM articles
    WHERE content_type IS NULL OR content_type = 'unknown'
    ORDER BY published_at DESC
    LIMIT ?
  `).all(limit) as ArticleRow[];

  console.log(`\n📊 CLASSIFYING ${articles.length} ARTICLES`);
  console.log('═'.repeat(50));

  const update = db.prepare(`
    UPDATE articles
    SET content_type = ?,
        content_type_confidence = ?,
        emotional_language_score = ?,
        loaded_terms = ?,
        named_source_count = ?,
        anonymous_source_count = ?,
        is_primary_source = ?
    WHERE id = ?
  `);

  const stats = { wire: 0, reporting: 0, analysis: 0, opinion: 0, editorial: 0, unknown: 0 };

  for (const article of articles) {
    const result = analyzeArticle(
      article.url,
      article.source_name,
      article.title,
      article.content
    );

    update.run(
      result.contentType,
      result.contentTypeConfidence,
      result.emotionalLanguageScore,
      JSON.stringify(result.loadedTerms),
      result.namedSourceCount,
      result.anonymousSourceCount,
      result.isPrimarySource ? 1 : 0,
      article.id
    );

    stats[result.contentType]++;

    // Progress indicator
    if (articles.indexOf(article) % 20 === 0) {
      process.stdout.write('.');
    }
  }

  db.close();

  console.log('\n\nClassification complete:');
  for (const [type, count] of Object.entries(stats)) {
    if (count > 0) {
      console.log(`  ${type.padEnd(12)} ${count}`);
    }
  }
}

/**
 * Show content type statistics
 */
function showContentTypeStats() {
  const db = new Database(dbPath, { readonly: true });

  console.log('\n📊 CONTENT TYPE BREAKDOWN');
  console.log('═'.repeat(50));

  // By content type
  const byType = db.query(`
    SELECT content_type, COUNT(*) as count,
           AVG(emotional_language_score) as avg_emotional
    FROM articles
    WHERE content_type IS NOT NULL
    GROUP BY content_type
    ORDER BY count DESC
  `).all() as { content_type: string; count: number; avg_emotional: number }[];

  const total = byType.reduce((sum, r) => sum + r.count, 0);

  for (const row of byType) {
    const pct = ((row.count / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(row.count / 20));
    const emotional = row.avg_emotional ? row.avg_emotional.toFixed(2) : 'N/A';
    console.log(`  ${(row.content_type || 'null').padEnd(12)} ${String(row.count).padStart(4)} (${pct.padStart(5)}%) emo:${emotional} ${bar}`);
  }

  // Wire services vs opinion by bias
  console.log('\n📊 FACT VS NARRATIVE BY BIAS');
  console.log('═'.repeat(50));

  const factVsNarrative = db.query(`
    SELECT
      bias,
      SUM(CASE WHEN content_type IN ('wire', 'reporting') THEN 1 ELSE 0 END) as fact_based,
      SUM(CASE WHEN content_type IN ('analysis', 'opinion', 'editorial') THEN 1 ELSE 0 END) as narrative_heavy,
      COUNT(*) as total
    FROM articles
    WHERE content_type IS NOT NULL
    GROUP BY bias
    ORDER BY
      CASE bias
        WHEN 'left' THEN 1
        WHEN 'lean-left' THEN 2
        WHEN 'center' THEN 3
        WHEN 'lean-right' THEN 4
        WHEN 'right' THEN 5
      END
  `).all() as { bias: string; fact_based: number; narrative_heavy: number; total: number }[];

  for (const row of factVsNarrative) {
    const factPct = ((row.fact_based / row.total) * 100).toFixed(0);
    const narrPct = ((row.narrative_heavy / row.total) * 100).toFixed(0);
    const factBar = '▓'.repeat(Math.round(row.fact_based / 10));
    const narrBar = '░'.repeat(Math.round(row.narrative_heavy / 10));
    console.log(`  ${row.bias.padEnd(12)} Fact:${factPct.padStart(3)}% ${factBar}${narrBar} Narr:${narrPct}%`);
  }

  db.close();
}

/**
 * Show narrative/emotional analysis
 */
function showNarrativeAnalysis() {
  const db = new Database(dbPath, { readonly: true });

  console.log('\n📊 NARRATIVE & EMOTIONAL LANGUAGE ANALYSIS');
  console.log('═'.repeat(60));

  // Average emotional score by source
  const bySource = db.query(`
    SELECT source_name, bias,
           AVG(emotional_language_score) as avg_emotional,
           COUNT(*) as count
    FROM articles
    WHERE emotional_language_score IS NOT NULL
    GROUP BY source_name
    HAVING count >= 5
    ORDER BY avg_emotional DESC
    LIMIT 15
  `).all() as { source_name: string; bias: string; avg_emotional: number; count: number }[];

  console.log('\n🔥 HIGHEST EMOTIONAL LANGUAGE (by source):');
  for (const row of bySource.slice(0, 10)) {
    const score = row.avg_emotional.toFixed(3);
    const bar = '█'.repeat(Math.round(row.avg_emotional * 20));
    console.log(`  ${score} ${bar} ${row.source_name} (${row.bias})`);
  }

  console.log('\n📋 LOWEST EMOTIONAL LANGUAGE (most neutral):');
  for (const row of bySource.slice(-5).reverse()) {
    const score = row.avg_emotional.toFixed(3);
    const bar = '█'.repeat(Math.round(row.avg_emotional * 20));
    console.log(`  ${score} ${bar} ${row.source_name} (${row.bias})`);
  }

  // Most common loaded terms
  console.log('\n📝 MOST COMMON LOADED TERMS:');
  const articles = db.query(`
    SELECT loaded_terms
    FROM articles
    WHERE loaded_terms IS NOT NULL AND loaded_terms != '[]'
  `).all() as { loaded_terms: string }[];

  const termCounts = new Map<string, { count: number; bias: string }>();
  for (const article of articles) {
    try {
      const terms = JSON.parse(article.loaded_terms) as { term: string; bias: string }[];
      for (const t of terms) {
        const existing = termCounts.get(t.term) || { count: 0, bias: t.bias };
        existing.count++;
        termCounts.set(t.term, existing);
      }
    } catch { /* skip invalid JSON */ }
  }

  const sortedTerms = Array.from(termCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);

  for (const [term, data] of sortedTerms) {
    const biasIcon = data.bias === 'left' ? '◀' : data.bias === 'right' ? '▶' : '⚡';
    console.log(`  ${biasIcon} "${term}" - ${data.count} uses (${data.bias})`);
  }

  db.close();
}

/**
 * Show wire service coverage
 */
function showWireCoverage() {
  const db = new Database(dbPath, { readonly: true });

  console.log('\n📰 WIRE SERVICE / FACT-BASELINE COVERAGE');
  console.log('═'.repeat(60));

  const wireArticles = db.query(`
    SELECT title, source_name, published_at
    FROM articles
    WHERE content_type = 'wire'
       OR source_name IN ('AP News', 'Reuters', 'PBS NewsHour')
    ORDER BY published_at DESC
    LIMIT 20
  `).all() as { title: string; source_name: string; published_at: string }[];

  console.log(`\nLatest ${wireArticles.length} wire service articles:`);
  for (const article of wireArticles) {
    const date = new Date(article.published_at).toLocaleDateString();
    console.log(`  [${date}] ${article.source_name.padEnd(15)} ${article.title.slice(0, 55)}...`);
  }

  // Compare wire vs editorial on same topic
  console.log('\n📊 FACT-BASELINE vs OPINION RATIO:');
  const ratio = db.query(`
    SELECT
      SUM(CASE WHEN content_type = 'wire' OR source_name IN ('AP News', 'Reuters', 'PBS NewsHour') THEN 1 ELSE 0 END) as wire,
      SUM(CASE WHEN content_type IN ('opinion', 'editorial') THEN 1 ELSE 0 END) as opinion,
      COUNT(*) as total
    FROM articles
  `).get() as { wire: number; opinion: number; total: number };

  if (ratio) {
    console.log(`  Wire/Fact-baseline: ${ratio.wire} articles (${((ratio.wire / ratio.total) * 100).toFixed(1)}%)`);
    console.log(`  Opinion/Editorial:  ${ratio.opinion} articles (${((ratio.opinion / ratio.total) * 100).toFixed(1)}%)`);
    console.log(`  Fact:Opinion Ratio: ${(ratio.wire / (ratio.opinion || 1)).toFixed(2)}:1`);
  }

  db.close();
}

/**
 * Show neutralized headlines
 */
function showNeutralizedHeadlines(daysBack: number = 2) {
  const db = new Database(dbPath, { readonly: true });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const articles = db.query(`
    SELECT title, source_name, bias, published_at
    FROM articles
    WHERE published_at >= ?
    ORDER BY published_at DESC
  `).all(cutoff.toISOString()) as { title: string; source_name: string; bias: string; published_at: string }[];

  console.log('\n📰 NEUTRALIZED HEADLINES');
  console.log('═'.repeat(70));
  console.log(`Analyzing ${articles.length} articles from last ${daysBack} day(s)\n`);

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function neutralizeText(text: string): { neutralized: string; terms: { term: string; neutral: string; bias: string }[] } {
    let neutralized = text;
    const termsFound: { term: string; neutral: string; bias: string }[] = [];

    const sortedTerms = Object.entries(LOADED_TERMS)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [term, data] of sortedTerms) {
      const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
      if (regex.test(neutralized)) {
        termsFound.push({ term, neutral: data.neutral, bias: data.bias });
        neutralized = neutralized.replace(regex, `[${data.neutral}]`);
      }
    }

    return { neutralized, terms: termsFound };
  }

  interface NeutralizedHeadline {
    original: string;
    neutralized: string;
    source: string;
    bias: string;
    termsFound: { term: string; neutral: string; bias: string }[];
  }

  const results: NeutralizedHeadline[] = [];

  for (const article of articles) {
    const { neutralized, terms } = neutralizeText(article.title);
    if (terms.length > 0) {
      results.push({
        original: article.title,
        neutralized,
        source: article.source_name,
        bias: article.bias,
        termsFound: terms
      });
    }
  }

  if (results.length === 0) {
    console.log('No loaded terms found in recent headlines.');
  } else {
    console.log(`Found ${results.length} headlines with loaded terms:\n`);

    const byBias: Record<string, NeutralizedHeadline[]> = { left: [], center: [], right: [] };

    for (const r of results) {
      const group = r.bias.includes('left') ? 'left' : r.bias.includes('right') ? 'right' : 'center';
      byBias[group].push(r);
    }

    for (const [group, headlines] of Object.entries(byBias)) {
      if (headlines.length === 0) continue;

      const icon = group === 'left' ? '◀' : group === 'right' ? '▶' : '●';
      console.log(`${icon} ${group.toUpperCase()} SOURCES (${headlines.length} headlines)`);
      console.log('─'.repeat(70));

      for (const h of headlines.slice(0, 6)) {
        console.log(`[${h.source}] (${h.bias})`);
        console.log(`  ORIGINAL:    ${h.original.slice(0, 65)}${h.original.length > 65 ? '...' : ''}`);
        console.log(`  NEUTRALIZED: ${h.neutralized.slice(0, 65)}${h.neutralized.length > 65 ? '...' : ''}`);
        console.log(`  Terms: ${h.termsFound.map(t => `"${t.term}" → "${t.neutral}"`).join(', ')}`);
        console.log();
      }
    }

    // Summary
    console.log('📊 MOST COMMON LOADED TERMS IN RECENT HEADLINES:');
    console.log('─'.repeat(70));

    const termStats = new Map<string, { count: number; bias: string }>();
    for (const r of results) {
      for (const t of r.termsFound) {
        const existing = termStats.get(t.term);
        if (!existing) {
          termStats.set(t.term, { count: 1, bias: t.bias });
        } else {
          existing.count++;
        }
      }
    }

    const sortedStats = Array.from(termStats.entries())
      .sort((a, b) => b[1].count - a[1].count);

    for (const [term, data] of sortedStats.slice(0, 10)) {
      const biasLabel = data.bias === 'left' ? '(L)' : data.bias === 'right' ? '(R)' : '(S)';
      console.log(`  ${biasLabel} "${term}" - ${data.count}x`);
    }
  }

  db.close();
}

/**
 * Show loaded term usage by source
 */
function showSourceTermUsage() {
  const db = new Database(dbPath, { readonly: true });

  const articles = db.query(`
    SELECT source_name, bias, loaded_terms
    FROM articles
    WHERE loaded_terms IS NOT NULL AND loaded_terms != '[]'
  `).all() as { source_name: string; bias: string; loaded_terms: string }[];

  console.log('\n📊 LOADED TERM USAGE BY SOURCE');
  console.log('═'.repeat(65));

  interface SourceStats {
    bias: string;
    totalTerms: number;
    articles: number;
    leftTerms: number;
    rightTerms: number;
    sensTerms: number;
    termList: Map<string, number>;
  }

  const sourceStats = new Map<string, SourceStats>();

  for (const article of articles) {
    const terms = JSON.parse(article.loaded_terms) as { term: string; bias: string }[];
    if (terms.length === 0) continue;

    if (!sourceStats.has(article.source_name)) {
      sourceStats.set(article.source_name, {
        bias: article.bias,
        totalTerms: 0,
        articles: 0,
        leftTerms: 0,
        rightTerms: 0,
        sensTerms: 0,
        termList: new Map()
      });
    }

    const stats = sourceStats.get(article.source_name)!;
    stats.articles++;

    for (const t of terms) {
      stats.totalTerms++;
      if (t.bias === 'left') stats.leftTerms++;
      else if (t.bias === 'right') stats.rightTerms++;
      else stats.sensTerms++;
      stats.termList.set(t.term, (stats.termList.get(t.term) || 0) + 1);
    }
  }

  const sorted = Array.from(sourceStats.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.totalTerms - a.totalTerms);

  console.log('\nSource                       Bias         Terms  Art   L   R   S');
  console.log('─'.repeat(65));

  for (const s of sorted.slice(0, 20)) {
    const biasIcon = s.bias.includes('left') ? '◀' : s.bias.includes('right') ? '▶' : '●';
    const topTerms = Array.from(s.termList.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t)
      .join(', ');

    console.log(`${biasIcon} ${s.name.padEnd(26)} ${s.bias.padEnd(12)} ${String(s.totalTerms).padStart(4)}  ${String(s.articles).padStart(3)}  ${String(s.leftTerms).padStart(2)}  ${String(s.rightTerms).padStart(2)}  ${String(s.sensTerms).padStart(2)}`);
    console.log(`    └─ ${topTerms}`);
  }

  // Summary by bias
  console.log('\n📊 AGGREGATED BY BIAS:');
  console.log('─'.repeat(65));

  const biasTotals: Record<string, { l: number; r: number; s: number; t: number }> = {
    left: { l: 0, r: 0, s: 0, t: 0 },
    center: { l: 0, r: 0, s: 0, t: 0 },
    right: { l: 0, r: 0, s: 0, t: 0 }
  };

  for (const s of sorted) {
    const group = s.bias.includes('left') ? 'left' : s.bias.includes('right') ? 'right' : 'center';
    biasTotals[group].l += s.leftTerms;
    biasTotals[group].r += s.rightTerms;
    biasTotals[group].s += s.sensTerms;
    biasTotals[group].t += s.totalTerms;
  }

  console.log('Bias Category      Total   Left-coded  Right-coded  Sensational');
  for (const [bias, totals] of Object.entries(biasTotals)) {
    if (totals.t > 0) {
      const icon = bias === 'left' ? '◀' : bias === 'right' ? '▶' : '●';
      console.log(`${icon} ${bias.padEnd(16)} ${String(totals.t).padStart(5)}   ${String(totals.l).padStart(5)}       ${String(totals.r).padStart(5)}        ${String(totals.s).padStart(5)}`);
    }
  }

  db.close();
}

// Main CLI
async function main() {
  const command = process.argv[2] || 'stats';

  switch (command) {
    case 'classify':
      const limit = parseInt(process.argv[3]) || 100;
      await classifyArticles(limit);
      break;

    case 'stats':
      showContentTypeStats();
      break;

    case 'narrative':
      showNarrativeAnalysis();
      break;

    case 'wire':
      showWireCoverage();
      break;

    case 'triangulate':
      const topic = process.argv.slice(3).join(' ') || 'congress';
      const result = await analyzeTopicCoverage(topic);
      displayTriangulation(result);
      break;

    case 'neutralize':
      const days = parseInt(process.argv[3]) || 2;
      showNeutralizedHeadlines(days);
      break;

    case 'sources':
      showSourceTermUsage();
      break;

    default:
      console.log(`
📊 Info Hygiene Analysis CLI

Commands:
  classify [limit]      Classify articles by content type
  stats                 Show content type statistics
  narrative             Show narrative/emotional analysis
  wire                  Show wire service coverage
  triangulate <topic>   Cross-source comparison on topic
  neutralize [days]     Show neutralized headlines (default: 2 days)
  sources               Show loaded term usage by source

Examples:
  bun run src/analysis/cli.ts classify 500
  bun run src/analysis/cli.ts triangulate immigration policy
  bun run src/analysis/cli.ts neutralize 7
  bun run src/analysis/cli.ts sources
      `);
  }
}

main().catch(console.error);
