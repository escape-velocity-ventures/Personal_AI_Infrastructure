/**
 * Scan for climate and energy loaded terms
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { LOADED_TERMS } from './types';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath, { readonly: true });

// Get climate/energy articles
const articles = db.query(`
  SELECT title, snippet, content, source_name, bias
  FROM articles
  WHERE LOWER(title) LIKE '%climate%'
     OR LOWER(title) LIKE '%carbon%'
     OR LOWER(title) LIKE '%emission%'
     OR LOWER(title) LIKE '%renewable%'
     OR LOWER(title) LIKE '%solar%'
     OR LOWER(title) LIKE '%wind power%'
     OR LOWER(title) LIKE '%fossil fuel%'
     OR LOWER(title) LIKE '%oil%'
     OR LOWER(title) LIKE '%gas%'
     OR LOWER(title) LIKE '%coal%'
     OR LOWER(title) LIKE '%green%'
     OR LOWER(title) LIKE '%energy%'
     OR LOWER(title) LIKE '%ev %'
     OR LOWER(title) LIKE '%electric vehicle%'
     OR LOWER(title) LIKE '%epa%'
     OR LOWER(title) LIKE '%environment%'
     OR LOWER(title) LIKE '%weather%'
     OR LOWER(title) LIKE '%wildfire%'
     OR LOWER(title) LIKE '%drought%'
     OR LOWER(title) LIKE '%flood%'
  ORDER BY published_at DESC
`).all() as { title: string; snippet: string | null; content: string | null; source_name: string; bias: string }[];

console.log('🌍 CLIMATE & ENERGY LOADED TERMS ANALYSIS');
console.log('═'.repeat(60));
console.log(`Scanning ${articles.length} climate/energy-related articles\n`);

// Climate-specific terms to check
const climateTerms: string[] = [
  // Left-coded climate terms
  'climate denier', 'climate denial', 'denier', 'fossil fuel industry',
  'big oil', 'oil lobby', 'climate emergency', 'climate crisis',
  'environmental justice', 'climate justice', 'greenwashing', 'dirty energy',
  'climate refugee', 'eco-anxiety', 'carbon footprint', 'climate action',
  'green new deal', 'just transition', 'frontline communities', 'sacrifice zone',
  'polluter', 'extraction', 'extractive', 'petrostate', 'stranded assets',
  'clean energy', 'renewable', 'sustainable', 'decarbonize', 'net zero',
  'climate hawk', 'tree hugger', 'environmentalist', 'climate activist',
  // Right-coded climate terms
  'climate alarmist', 'alarmist', 'green agenda', 'climate agenda',
  'war on coal', 'war on energy', 'climate hoax', 'eco-terrorist',
  'radical environmentalist', 'climate hysteria', 'green extremist',
  'energy independence', 'energy security', 'baseload power', 'reliable energy',
  'clean coal', 'natural gas bridge', 'all-of-the-above', 'energy dominance',
  'job-killing regulation', 'regulatory overreach', 'carbon tax', 'green boondoggle',
  'solyndra', 'ev mandate', 'gas stove ban', 'climate lockdown',
  'woke esg', 'esg agenda', 'climate cult', 'church of climate',
  // Sensational climate terms
  'climate apocalypse', 'climate catastrophe', 'climate collapse', 'tipping point',
  'mass extinction', 'uninhabitable', 'point of no return', 'existential threat',
  'climate bomb', 'carbon bomb', 'methane bomb', 'climate time bomb',
  'extreme weather', 'weather bomb', 'bomb cyclone', 'atmospheric river',
  'unprecedented', 'record-breaking', 'historic', 'worst ever',
  'energy crisis', 'blackout', 'grid collapse', 'rolling blackout',
  'price shock', 'skyrocketing', 'plummeting'
];

const termCounts: Record<string, { left: number; center: number; right: number }> = {};
for (const term of climateTerms) {
  termCounts[term] = { left: 0, center: 0, right: 0 };
}

const articlesWithTerms: { title: string; source: string; bias: string; terms: string[] }[] = [];

for (const article of articles) {
  const text = `${article.title} ${article.snippet || ''} ${article.content || ''}`.toLowerCase();
  const biasGroup = article.bias.includes('left') ? 'left' :
                    article.bias.includes('right') ? 'right' : 'center';

  const foundTerms: string[] = [];

  for (const term of climateTerms) {
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

if (found.length === 0) {
  console.log('No climate-specific loaded terms found in article titles/snippets.');
  console.log('\nThis could mean:');
  console.log('  - Climate coverage is using relatively neutral language');
  console.log('  - Need to collect more climate-focused sources');
  console.log('  - Terms appear in full article content but not headlines\n');
} else {
  console.log('DETECTED CLIMATE/ENERGY LOADED TERMS:');
  console.log('─'.repeat(60));
  console.log('Term                       Left  Center  Right  Total');
  console.log('─'.repeat(60));

  for (const [term, counts] of found) {
    const total = counts.left + counts.center + counts.right;
    const termData = LOADED_TERMS[term];
    const biasLabel = termData ? (termData.bias === 'left' ? '(L)' : termData.bias === 'right' ? '(R)' : '(S)') : '(?)';
    console.log(`${biasLabel} ${term.padEnd(24)} ${String(counts.left).padStart(4)}  ${String(counts.center).padStart(4)}  ${String(counts.right).padStart(4)}  ${String(total).padStart(4)}`);
  }
}

// Show sample climate headlines
console.log('\n📰 SAMPLE CLIMATE/ENERGY HEADLINES:');
console.log('─'.repeat(60));

for (const article of articles.slice(0, 15)) {
  const biasIcon = article.bias.includes('left') ? '◀' : article.bias.includes('right') ? '▶' : '●';

  // Check if any climate loaded terms
  const text = article.title.toLowerCase();
  const loadedFound: string[] = [];
  for (const [term, data] of Object.entries(LOADED_TERMS)) {
    if (text.includes(term.toLowerCase())) {
      loadedFound.push(`"${term}" (${data.bias[0].toUpperCase()})`);
    }
  }

  const status = loadedFound.length > 0 ? `⚠️ ${loadedFound.join(', ')}` : '✓ neutral';
  console.log(`${biasIcon} [${article.source_name}]`);
  console.log(`  "${article.title.slice(0, 60)}${article.title.length > 60 ? '...' : ''}"`);
  console.log(`  ${status}`);
  console.log();
}

// Show articles with most loaded terms
if (articlesWithTerms.length > 0) {
  console.log('📊 ARTICLES WITH MOST LOADED TERMS:');
  console.log('─'.repeat(60));

  const sorted = articlesWithTerms.sort((a, b) => b.terms.length - a.terms.length);
  for (const a of sorted.slice(0, 10)) {
    const biasIcon = a.bias.includes('left') ? '◀' : a.bias.includes('right') ? '▶' : '●';
    console.log(`${biasIcon} [${a.source}] (${a.bias})`);
    console.log(`  "${a.title.slice(0, 55)}${a.title.length > 55 ? '...' : ''}"`);
    console.log(`  Terms: ${a.terms.join(', ')}`);
    console.log();
  }
}

// Count climate terms in dictionary
const climateTermsInDict = Object.keys(LOADED_TERMS).filter(t =>
  t.includes('climate') || t.includes('carbon') || t.includes('green') ||
  t.includes('fossil') || t.includes('renewable') || t.includes('emission') ||
  t.includes('energy') || t.includes('coal') || t.includes('oil') ||
  t.includes('solar') || t.includes('wind') || t.includes('eco') ||
  t.includes('environment') || t.includes('weather') || t.includes('sustain')
).length;

console.log('📊 CLIMATE/ENERGY TERM DICTIONARY STATS:');
console.log('─'.repeat(60));
console.log(`  Climate/energy terms in dictionary: ${climateTermsInDict}`);
console.log('  Categories: pro-action (L), skeptical (R), sensational (S)');

db.close();
