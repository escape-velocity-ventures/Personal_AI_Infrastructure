/**
 * Triangulation System
 *
 * Cross-references coverage from multiple sources to identify:
 * - Agreed facts (covered by 2+ sources across bias spectrum)
 * - Contested claims (sources disagree)
 * - Framing differences (same event, different spin)
 * - Omissions (what each side leaves out)
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { analyzeArticle } from './classifier';
import type { BiasRating, ContentType } from '../db/schema';
import type {
  Triangulation,
  TriangulatedSource,
  ContestedClaim,
  FramingDiff,
  Omission,
} from './types';

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
}

interface TopicGroup {
  topic: string;
  articles: ArticleRow[];
}

/**
 * Find related articles using keyword/topic matching
 * Groups articles that are likely covering the same event/topic
 */
export function findRelatedArticles(
  db: Database,
  topic: string,
  daysBack: number = 3
): ArticleRow[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  // Search by title keywords
  const keywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const likePatterns = keywords.map(k => `%${k}%`);

  // Build query with multiple LIKE conditions
  const conditions = likePatterns.map(() => 'LOWER(title) LIKE ?').join(' OR ');

  const query = `
    SELECT id, url, title, content, snippet, source_name, bias, published_at, content_type
    FROM articles
    WHERE (${conditions})
      AND published_at >= ?
    ORDER BY published_at DESC
    LIMIT 50
  `;

  return db.query(query).all(...likePatterns, cutoff.toISOString()) as ArticleRow[];
}

/**
 * Group articles by bias category for comparison
 */
function groupByBias(articles: ArticleRow[]): Map<string, ArticleRow[]> {
  const groups = new Map<string, ArticleRow[]>();

  // Group into left, center, right
  const biasGroups: Record<string, BiasRating[]> = {
    left: ['left', 'lean-left'],
    center: ['center'],
    right: ['lean-right', 'right'],
  };

  for (const [group, biases] of Object.entries(biasGroups)) {
    const matching = articles.filter(a => biases.includes(a.bias));
    if (matching.length > 0) {
      groups.set(group, matching);
    }
  }

  return groups;
}

/**
 * Extract key entities and facts from article content
 */
function extractKeyFacts(article: ArticleRow): string[] {
  const facts: string[] = [];
  const text = `${article.title} ${article.snippet || ''} ${article.content || ''}`;

  // Extract quoted statements
  const quotes = text.match(/"[^"]{20,150}"/g) || [];
  facts.push(...quotes.slice(0, 3).map(q => `Quote: ${q}`));

  // Extract statistics/numbers in context
  const stats = text.match(/\d+(\.\d+)?%?\s+(of|percent|million|billion|people|dollars)/gi) || [];
  facts.push(...stats.slice(0, 3).map(s => `Stat: ${s}`));

  // Extract named entities with actions
  const actions = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)\s+(said|announced|confirmed|denied|criticized|praised)/g) || [];
  facts.push(...actions.slice(0, 3).map(a => `Action: ${a}`));

  return facts;
}

/**
 * Compare coverage across bias groups to find agreements and differences
 */
export function triangulate(
  topic: string,
  articles: ArticleRow[]
): Triangulation {
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const biasGroups = groupByBias(articles);

  // Analyze each article
  const sources: TriangulatedSource[] = articles.map(article => {
    const analysis = analyzeArticle(
      article.url,
      article.source_name,
      article.title,
      article.content
    );

    return {
      articleId: article.id,
      sourceName: article.source_name,
      bias: article.bias,
      contentType: analysis.contentType,
      claims: [], // Would be populated by LLM extraction
      entities: [],
      narrative: {
        framing: '', // Would be populated by LLM
        emotionalLanguageScore: analysis.emotionalLanguageScore,
        loadedTerms: analysis.loadedTerms,
        headlines: { original: article.title },
      },
    };
  });

  // Extract facts from each group
  const factsByGroup = new Map<string, string[]>();
  for (const [group, groupArticles] of biasGroups) {
    const facts = groupArticles.flatMap(a => extractKeyFacts(a));
    factsByGroup.set(group, facts);
  }

  // Find agreed facts (mentioned by 2+ groups)
  const allFacts = new Set<string>();
  const factCounts = new Map<string, number>();

  for (const facts of factsByGroup.values()) {
    for (const fact of facts) {
      const normalized = fact.toLowerCase();
      allFacts.add(normalized);
      factCounts.set(normalized, (factCounts.get(normalized) || 0) + 1);
    }
  }

  const agreedFacts = Array.from(factCounts.entries())
    .filter(([_, count]) => count >= 2)
    .map(([fact]) => fact);

  // Detect framing differences by comparing headlines
  const framingDiffs: FramingDiff[] = [];
  const leftHeadlines = biasGroups.get('left')?.map(a => a.title) || [];
  const rightHeadlines = biasGroups.get('right')?.map(a => a.title) || [];
  const centerHeadlines = biasGroups.get('center')?.map(a => a.title) || [];

  if (leftHeadlines.length > 0 && rightHeadlines.length > 0) {
    framingDiffs.push({
      aspect: 'headline framing',
      leftFraming: leftHeadlines[0],
      centerFraming: centerHeadlines[0],
      rightFraming: rightHeadlines[0],
    });
  }

  // Detect omissions (facts in one group but not others)
  const omissions: Omission[] = [];
  for (const [group, facts] of factsByGroup) {
    for (const fact of facts) {
      const normalized = fact.toLowerCase();
      const includedBy = [group];
      const omittedBy: string[] = [];

      for (const [otherGroup, otherFacts] of factsByGroup) {
        if (otherGroup !== group) {
          const hasIt = otherFacts.some(f => f.toLowerCase().includes(normalized.slice(0, 30)));
          if (hasIt) {
            includedBy.push(otherGroup);
          } else {
            omittedBy.push(otherGroup);
          }
        }
      }

      if (omittedBy.length > 0 && includedBy.length === 1) {
        omissions.push({
          fact: fact,
          includedBy,
          omittedBy,
          significance: omittedBy.length >= 2 ? 'high' : 'medium',
        });
      }
    }
  }

  // Dedupe omissions
  const uniqueOmissions = omissions.filter((o, i, arr) =>
    arr.findIndex(x => x.fact === o.fact) === i
  ).slice(0, 10);

  return {
    eventId,
    eventDescription: topic,
    sources,
    agreedFacts: agreedFacts.slice(0, 10),
    contestedClaims: [], // Would require LLM analysis
    framingDifferences: framingDiffs,
    omissions: uniqueOmissions,
  };
}

/**
 * Run triangulation analysis on recent coverage of a topic
 */
export async function analyzeTopicCoverage(topic: string): Promise<Triangulation> {
  const db = new Database(dbPath, { readonly: true });

  try {
    const articles = findRelatedArticles(db, topic);

    if (articles.length < 2) {
      throw new Error(`Not enough articles found for topic: ${topic}`);
    }

    const result = triangulate(topic, articles);

    // Summary stats
    const biasGroups = groupByBias(articles);
    console.log(`\n📊 TRIANGULATION: "${topic}"`);
    console.log('═'.repeat(50));
    console.log(`Found ${articles.length} related articles:`);
    for (const [group, groupArticles] of biasGroups) {
      console.log(`  ${group.toUpperCase()}: ${groupArticles.length} articles`);
    }
    console.log(`\n✓ Agreed facts: ${result.agreedFacts.length}`);
    console.log(`⚡ Framing differences: ${result.framingDifferences.length}`);
    console.log(`? Potential omissions: ${result.omissions.length}`);

    return result;
  } finally {
    db.close();
  }
}

/**
 * Display triangulation results
 */
export function displayTriangulation(result: Triangulation): void {
  console.log(`\n📰 COVERAGE ANALYSIS: ${result.eventDescription}`);
  console.log('═'.repeat(60));

  // Sources by bias
  console.log('\n📍 SOURCES BY PERSPECTIVE:');
  const byBias = new Map<string, TriangulatedSource[]>();
  for (const source of result.sources) {
    const key = source.bias;
    if (!byBias.has(key)) byBias.set(key, []);
    byBias.get(key)!.push(source);
  }

  for (const [bias, sources] of byBias) {
    console.log(`  ${bias.toUpperCase()}:`);
    for (const source of sources.slice(0, 3)) {
      const emotional = source.narrative.emotionalLanguageScore;
      const emotionalLabel = emotional > 0.5 ? '🔥' : emotional > 0.2 ? '⚡' : '📋';
      console.log(`    ${emotionalLabel} ${source.sourceName}: ${source.narrative.headlines.original.slice(0, 50)}...`);
    }
  }

  // Agreed facts
  if (result.agreedFacts.length > 0) {
    console.log('\n✅ AGREED FACTS (covered by multiple sources):');
    for (const fact of result.agreedFacts.slice(0, 5)) {
      console.log(`  • ${fact.slice(0, 80)}`);
    }
  }

  // Framing differences
  if (result.framingDifferences.length > 0) {
    console.log('\n⚡ FRAMING DIFFERENCES:');
    for (const diff of result.framingDifferences) {
      console.log(`  ${diff.aspect}:`);
      if (diff.leftFraming) console.log(`    LEFT:   "${diff.leftFraming.slice(0, 60)}..."`);
      if (diff.centerFraming) console.log(`    CENTER: "${diff.centerFraming.slice(0, 60)}..."`);
      if (diff.rightFraming) console.log(`    RIGHT:  "${diff.rightFraming.slice(0, 60)}..."`);
    }
  }

  // Omissions
  if (result.omissions.length > 0) {
    console.log('\n❓ POTENTIAL OMISSIONS:');
    for (const omission of result.omissions.slice(0, 5)) {
      const icon = omission.significance === 'high' ? '⚠️' : '❔';
      console.log(`  ${icon} ${omission.fact.slice(0, 60)}`);
      console.log(`     Included by: ${omission.includedBy.join(', ')}`);
      console.log(`     Omitted by: ${omission.omittedBy.join(', ')}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
}

// CLI usage
if (import.meta.main) {
  const topic = process.argv[2] || 'congress budget';
  const result = await analyzeTopicCoverage(topic);
  displayTriangulation(result);
}
