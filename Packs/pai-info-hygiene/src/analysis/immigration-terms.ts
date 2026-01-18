/**
 * Show loaded terms used in immigration coverage
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath, { readonly: true });

// Get immigration-related articles with loaded terms
const articles = db.query(`
  SELECT title, source_name, bias, loaded_terms, emotional_language_score
  FROM articles
  WHERE (LOWER(title) LIKE '%immigra%'
     OR LOWER(title) LIKE '%deporta%'
     OR LOWER(title) LIKE '%ice %'
     OR LOWER(title) LIKE '%border%'
     OR LOWER(title) LIKE '%migrant%'
     OR LOWER(title) LIKE '%illegal%')
    AND loaded_terms IS NOT NULL
    AND loaded_terms != '[]'
  ORDER BY emotional_language_score DESC
`).all() as { title: string; source_name: string; bias: string; loaded_terms: string; emotional_language_score: number | null }[];

console.log('📝 LOADED TERMS IN IMMIGRATION COVERAGE');
console.log('═'.repeat(60));
console.log(`Found ${articles.length} articles with detected loaded terms\n`);

// Aggregate term usage by source bias
const termsByBias: Record<string, Map<string, { count: number; bias: string }>> = {
  left: new Map(),
  center: new Map(),
  right: new Map()
};

interface ArticleDetail {
  title: string;
  source: string;
  bias: string;
  emotional: string;
  terms: string[];
}

const articleDetails: ArticleDetail[] = [];

for (const article of articles) {
  const terms = JSON.parse(article.loaded_terms) as { term: string; bias: string }[];
  const biasGroup = article.bias.includes('left') ? 'left' :
                    article.bias.includes('right') ? 'right' : 'center';

  for (const t of terms) {
    const map = termsByBias[biasGroup];
    const existing = map.get(t.term);
    if (!existing) {
      map.set(t.term, { count: 1, bias: t.bias });
    } else {
      existing.count++;
    }
  }

  if (terms.length > 0) {
    articleDetails.push({
      title: article.title.slice(0, 55),
      source: article.source_name,
      bias: article.bias,
      emotional: article.emotional_language_score?.toFixed(3) || 'N/A',
      terms: terms.map(t => t.term)
    });
  }
}

// Show by source bias
for (const [group, map] of Object.entries(termsByBias)) {
  if (map.size === 0) continue;
  const icon = group === 'left' ? '◀' : group === 'right' ? '▶' : '●';
  console.log(`${icon} ${group.toUpperCase()} SOURCES using loaded terms:`);

  const sorted = Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  for (const [term, data] of sorted) {
    const biasIcon = data.bias === 'left' ? '(L)' : data.bias === 'right' ? '(R)' : '(S)';
    console.log(`    "${term}" ${biasIcon} - ${data.count}x`);
  }
  console.log();
}

// Show specific articles
console.log('📰 ARTICLES WITH HIGHEST EMOTIONAL SCORES:');
console.log('─'.repeat(60));
for (const a of articleDetails.slice(0, 12)) {
  console.log(`  [${a.emotional}] ${a.source} (${a.bias})`);
  console.log(`    "${a.title}..."`);
  console.log(`    Terms: ${a.terms.join(', ')}`);
  console.log();
}

db.close();
