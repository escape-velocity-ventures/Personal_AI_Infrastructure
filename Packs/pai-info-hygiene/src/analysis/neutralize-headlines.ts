/**
 * Show neutralized versions of today's headlines
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { LOADED_TERMS } from './types';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath, { readonly: true });

// Get recent articles (last 2 days)
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 2);

const articles = db.query(`
  SELECT title, source_name, bias, published_at, url
  FROM articles
  WHERE published_at >= ?
  ORDER BY published_at DESC
`).all(cutoff.toISOString()) as { title: string; source_name: string; bias: string; published_at: string; url: string }[];

console.log('📰 NEUTRALIZED HEADLINES');
console.log('═'.repeat(70));
console.log(`Analyzing ${articles.length} recent articles\n`);

interface NeutralizedHeadline {
  original: string;
  neutralized: string;
  source: string;
  bias: string;
  termsFound: { term: string; neutral: string; bias: string }[];
}

const results: NeutralizedHeadline[] = [];

function neutralizeText(text: string): { neutralized: string; terms: { term: string; neutral: string; bias: string }[] } {
  let neutralized = text;
  const termsFound: { term: string; neutral: string; bias: string }[] = [];

  // Sort terms by length (longer first) to avoid partial replacements
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  console.log('No loaded terms found in recent headlines.\n');
  console.log('Showing sample headlines for context:\n');

  for (const article of articles.slice(0, 15)) {
    const biasIcon = article.bias.includes('left') ? '◀' : article.bias.includes('right') ? '▶' : '●';
    console.log(`${biasIcon} [${article.source_name}]`);
    console.log(`  ${article.title.slice(0, 70)}${article.title.length > 70 ? '...' : ''}\n`);
  }
} else {
  console.log(`Found ${results.length} headlines with loaded terms:\n`);

  // Group by bias
  const byBias: Record<string, NeutralizedHeadline[]> = {
    left: [],
    center: [],
    right: []
  };

  for (const r of results) {
    const group = r.bias.includes('left') ? 'left' : r.bias.includes('right') ? 'right' : 'center';
    byBias[group].push(r);
  }

  for (const [group, headlines] of Object.entries(byBias)) {
    if (headlines.length === 0) continue;

    const icon = group === 'left' ? '◀' : group === 'right' ? '▶' : '●';
    console.log(`${icon} ${group.toUpperCase()} SOURCES (${headlines.length} headlines)`);
    console.log('─'.repeat(70));

    for (const h of headlines.slice(0, 8)) {
      console.log(`[${h.source}] (${h.bias})`);
      console.log(`  ORIGINAL:    ${h.original}`);
      console.log(`  NEUTRALIZED: ${h.neutralized}`);
      console.log(`  Terms: ${h.termsFound.map(t => `"${t.term}" (${t.bias[0].toUpperCase()}) → "${t.neutral}"`).join(', ')}`);
      console.log();
    }
  }

  // Summary
  console.log('📊 SUMMARY:');
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

  console.log('\nMost common loaded terms in today\'s headlines:');
  for (const [term, data] of sortedStats.slice(0, 10)) {
    const biasLabel = data.bias === 'left' ? '(L)' : data.bias === 'right' ? '(R)' : '(S)';
    console.log(`  ${biasLabel} "${term}" - ${data.count}x`);
  }
}

db.close();
