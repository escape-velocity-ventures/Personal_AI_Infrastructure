/**
 * Analyze loaded term usage by source
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath, { readonly: true });

interface TermData {
  term: string;
  bias: 'left' | 'right' | 'sensational';
}

interface SourceStats {
  bias: string;
  totalTerms: number;
  articles: number;
  leftTerms: number;
  rightTerms: number;
  sensTerms: number;
  termList: Map<string, number>;
}

// Get all articles with loaded terms
const articles = db.query(`
  SELECT source_name, bias, loaded_terms, title
  FROM articles
  WHERE loaded_terms IS NOT NULL AND loaded_terms != '[]'
`).all() as { source_name: string; bias: string; loaded_terms: string; title: string }[];

console.log('📊 LOADED TERM USAGE BY SOURCE');
console.log('═'.repeat(65));

// Aggregate by source
const sourceStats = new Map<string, SourceStats>();

for (const article of articles) {
  const terms = JSON.parse(article.loaded_terms) as TermData[];
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

// Sort by total terms
const sorted = Array.from(sourceStats.entries())
  .map(([name, stats]) => ({ name, ...stats }))
  .sort((a, b) => b.totalTerms - a.totalTerms);

console.log('\nSource                       Bias         Terms  Art   L   R   S');
console.log('─'.repeat(65));

for (const s of sorted.slice(0, 25)) {
  const biasIcon = s.bias.includes('left') ? '◀' : s.bias.includes('right') ? '▶' : '●';
  const topTerms = Array.from(s.termList.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)
    .join(', ');

  console.log(`${biasIcon} ${s.name.padEnd(26)} ${s.bias.padEnd(12)} ${String(s.totalTerms).padStart(4)}  ${String(s.articles).padStart(3)}  ${String(s.leftTerms).padStart(2)}  ${String(s.rightTerms).padStart(2)}  ${String(s.sensTerms).padStart(2)}`);
  console.log(`    └─ ${topTerms}`);
}

// Summary by bias category
console.log('\n📊 AGGREGATED BY BIAS CATEGORY:');
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
console.log('─'.repeat(65));
for (const [bias, totals] of Object.entries(biasTotals)) {
  if (totals.t > 0) {
    const icon = bias === 'left' ? '◀' : bias === 'right' ? '▶' : '●';
    console.log(`${icon} ${bias.padEnd(16)} ${String(totals.t).padStart(5)}   ${String(totals.l).padStart(5)}       ${String(totals.r).padStart(5)}        ${String(totals.s).padStart(5)}`);
  }
}

// Cross-usage analysis
console.log('\n⚠️  CROSS-BIAS TERM USAGE (sources using opposing-side terms):');
console.log('─'.repeat(65));

let crossUsageFound = false;
for (const s of sorted) {
  const isLeft = s.bias.includes('left');
  const isRight = s.bias.includes('right');

  if (isLeft && s.rightTerms > 0) {
    crossUsageFound = true;
    const rightTermsUsed = Array.from(s.termList.entries())
      .filter(([term]) => {
        // Check if term is right-coded (simplified check)
        const rightTerms = ['illegal alien', 'illegal aliens', 'illegals', 'criminal alien', 'sanctuary', 'invasion', 'amnesty', 'chain migration', 'open border', 'woke', 'radical left', 'mainstream media'];
        return rightTerms.some(rt => term.toLowerCase().includes(rt));
      })
      .map(([t]) => `"${t}"`)
      .join(', ');
    console.log(`◀ ${s.name} (${s.bias}) uses ${s.rightTerms} RIGHT-coded terms`);
    if (rightTermsUsed) console.log(`    └─ ${rightTermsUsed}`);
  }
  if (isRight && s.leftTerms > 0) {
    crossUsageFound = true;
    const leftTermsUsed = Array.from(s.termList.entries())
      .filter(([term]) => {
        const leftTerms = ['undocumented', 'asylum seeker', 'far-right', 'far right', 'dreamers', 'family separation', 'xenophobic'];
        return leftTerms.some(lt => term.toLowerCase().includes(lt));
      })
      .map(([t]) => `"${t}"`)
      .join(', ');
    console.log(`▶ ${s.name} (${s.bias}) uses ${s.leftTerms} LEFT-coded terms`);
    if (leftTermsUsed) console.log(`    └─ ${leftTermsUsed}`);
  }
}

if (!crossUsageFound) {
  console.log('  No significant cross-bias term usage detected');
}

// Highest emotional language scorers
console.log('\n🔥 SOURCES WITH HIGHEST LOADED TERM DENSITY:');
console.log('─'.repeat(65));

// Get article counts by source
const articleCounts = db.query(`
  SELECT source_name, COUNT(*) as count
  FROM articles
  GROUP BY source_name
`).all() as { source_name: string; count: number }[];

const countMap = new Map(articleCounts.map(x => [x.source_name, x.count]));

const density = sorted
  .map(s => ({
    ...s,
    totalArticles: countMap.get(s.name) || s.articles,
    density: s.totalTerms / (countMap.get(s.name) || s.articles)
  }))
  .filter(s => s.totalArticles >= 5) // Only sources with 5+ articles
  .sort((a, b) => b.density - a.density);

console.log('Source                       Bias          Terms/Art  Articles');
console.log('─'.repeat(65));
for (const s of density.slice(0, 10)) {
  const biasIcon = s.bias.includes('left') ? '◀' : s.bias.includes('right') ? '▶' : '●';
  console.log(`${biasIcon} ${s.name.padEnd(26)} ${s.bias.padEnd(12)}  ${s.density.toFixed(3).padStart(6)}    ${String(s.totalArticles).padStart(4)}`);
}

db.close();
