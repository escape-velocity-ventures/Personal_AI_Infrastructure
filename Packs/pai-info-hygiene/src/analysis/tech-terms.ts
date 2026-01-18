/**
 * Show loaded terms used in tech/business coverage
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { LOADED_TERMS } from './types';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath, { readonly: true });

// Get tech/business articles
const articles = db.query(`
  SELECT title, snippet, content, source_name, bias, source_type
  FROM articles
  WHERE source_type IN ('tech', 'auto', 'energy')
     OR LOWER(title) LIKE '%tesla%'
     OR LOWER(title) LIKE '%musk%'
     OR LOWER(title) LIKE '%apple%'
     OR LOWER(title) LIKE '%google%'
     OR LOWER(title) LIKE '%amazon%'
     OR LOWER(title) LIKE '%microsoft%'
     OR LOWER(title) LIKE '%ai %'
     OR LOWER(title) LIKE '%stock%'
     OR LOWER(title) LIKE '%market%'
     OR LOWER(title) LIKE '%profit%'
     OR LOWER(title) LIKE '%layoff%'
     OR LOWER(title) LIKE '%ceo%'
  ORDER BY published_at DESC
`).all() as { title: string; snippet: string | null; content: string | null; source_name: string; bias: string; source_type: string }[];

console.log('📊 TECH & BUSINESS LOADED TERMS ANALYSIS');
console.log('═'.repeat(60));
console.log(`Scanning ${articles.length} tech/business articles\n`);

// Define tech/business specific terms to check
const techTerms: Record<string, { neutral: string; bias: string }> = {};
for (const [term, data] of Object.entries(LOADED_TERMS)) {
  // Include tech terms and market sensational terms
  if (term.includes('tech') || term.includes('big ') || term.includes('job') ||
      term.includes('tax') || term.includes('corporate') || term.includes('profit') ||
      term.includes('monopol') || term.includes('censor') || term.includes('woke') ||
      term.includes('layoff') || term.includes('plummet') || term.includes('crash') ||
      term.includes('soar') || term.includes('skyrocket') || term.includes('tank') ||
      term.includes('surge') || term.includes('killer') || term.includes('disrupt') ||
      term.includes('exploit') || term.includes('greed') || term.includes('elite') ||
      term.includes('regulat') || term.includes('red tape') || term.includes('dei') ||
      term.includes('esg') || term.includes('cancel') || term.includes('shadow')) {
    techTerms[term] = data;
  }
}

console.log(`Checking for ${Object.keys(techTerms).length} tech/business loaded terms\n`);

// Scan articles
const termCounts: Record<string, { left: number; center: number; right: number; bias: string }> = {};

for (const [term, data] of Object.entries(techTerms)) {
  termCounts[term] = { left: 0, center: 0, right: 0, bias: data.bias };
}

const articlesWithTerms: { title: string; source: string; bias: string; terms: string[] }[] = [];

for (const article of articles) {
  const text = `${article.title} ${article.snippet || ''} ${article.content || ''}`.toLowerCase();
  const biasGroup = article.bias.includes('left') ? 'left' :
                    article.bias.includes('right') ? 'right' : 'center';

  const foundTerms: string[] = [];

  for (const term of Object.keys(techTerms)) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(text)) {
      termCounts[term][biasGroup]++;
      foundTerms.push(term);
    }
  }

  if (foundTerms.length > 0) {
    articlesWithTerms.push({
      title: article.title,
      source: article.source_name,
      bias: article.bias,
      terms: foundTerms
    });
  }
}

// Show results
const found = Object.entries(termCounts)
  .filter(([_, counts]) => counts.left + counts.center + counts.right > 0)
  .sort((a, b) => (b[1].left + b[1].center + b[1].right) - (a[1].left + a[1].center + a[1].right));

console.log('TERM USAGE BY SOURCE BIAS:');
console.log('─'.repeat(60));
console.log('Term                       Bias   Left  Center  Right  Total');
console.log('─'.repeat(60));

for (const [term, counts] of found.slice(0, 25)) {
  const total = counts.left + counts.center + counts.right;
  const biasLabel = counts.bias === 'left' ? '(L)' : counts.bias === 'right' ? '(R)' : '(S)';
  const l = counts.left > 0 ? String(counts.left) : '-';
  const c = counts.center > 0 ? String(counts.center) : '-';
  const r = counts.right > 0 ? String(counts.right) : '-';
  console.log(`${term.padEnd(26)} ${biasLabel}    ${l.padStart(3)}   ${c.padStart(4)}   ${r.padStart(4)}   ${String(total).padStart(4)}`);
}

// Show articles with most terms
console.log('\n📰 ARTICLES WITH LOADED TERMS:');
console.log('─'.repeat(60));

const sortedArticles = articlesWithTerms.sort((a, b) => b.terms.length - a.terms.length);

for (const a of sortedArticles.slice(0, 15)) {
  const biasIcon = a.bias.includes('left') ? '◀' : a.bias.includes('right') ? '▶' : '●';
  console.log(`${biasIcon} [${a.source}] (${a.bias})`);
  console.log(`  "${a.title.slice(0, 60)}${a.title.length > 60 ? '...' : ''}"`);
  console.log(`  Terms: ${a.terms.join(', ')}`);
  console.log();
}

// Summary
console.log('📊 SUMMARY:');
console.log('─'.repeat(60));

let leftTotal = 0, rightTotal = 0, sensTotal = 0;
for (const [_, counts] of found) {
  const total = counts.left + counts.center + counts.right;
  if (counts.bias === 'left') leftTotal += total;
  else if (counts.bias === 'right') rightTotal += total;
  else sensTotal += total;
}

console.log(`  Left-coded tech terms:  ${leftTotal} instances`);
console.log(`  Right-coded tech terms: ${rightTotal} instances`);
console.log(`  Sensational tech terms: ${sensTotal} instances`);
console.log(`  Articles with terms:    ${articlesWithTerms.length} of ${articles.length}`);

db.close();
