/**
 * Scan for AI-specific loaded terms
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { LOADED_TERMS } from './types';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath, { readonly: true });

// Get AI-related articles
const articles = db.query(`
  SELECT title, snippet, content, source_name, bias
  FROM articles
  WHERE LOWER(title) LIKE '%ai %'
     OR LOWER(title) LIKE '% ai%'
     OR LOWER(title) LIKE '%artificial intelligence%'
     OR LOWER(title) LIKE '%openai%'
     OR LOWER(title) LIKE '%chatgpt%'
     OR LOWER(title) LIKE '%gpt-%'
     OR LOWER(title) LIKE '%llm%'
     OR LOWER(title) LIKE '%machine learning%'
     OR LOWER(title) LIKE '%deep learning%'
     OR LOWER(title) LIKE '%neural%'
     OR LOWER(title) LIKE '%robot%'
     OR LOWER(title) LIKE '%automat%'
     OR LOWER(title) LIKE '%algorithm%'
  ORDER BY published_at DESC
`).all() as { title: string; snippet: string | null; content: string | null; source_name: string; bias: string }[];

console.log('🤖 AI-SPECIFIC LOADED TERMS ANALYSIS');
console.log('═'.repeat(60));
console.log(`Scanning ${articles.length} AI-related articles\n`);

// AI-specific terms to check
const aiTerms: string[] = [
  // Dismissive of safety
  'ai doomer', 'agi doomer', 'doomers', 'doomerism', 'ai hysteria', 'ai fearmongering',
  'luddites', 'neo-luddite', 'alarmist', 'ai panic', 'stifling innovation',
  'techno-optimist', 'e/acc', 'accelerationist',
  // Critical of AI industry
  'ai bro', 'tech bro', 'ai hype', 'hype cycle', 'ai bubble', 'vaporware',
  'ai washing', 'ai snake oil', 'algorithmic bias', 'biased algorithm',
  'reckless ai', 'unchecked ai', 'ai overlords', 'silicon valley hubris',
  // Sensational AI terms
  'agi', 'superintelligence', 'sentient', 'conscious ai', 'singularity',
  'ai takeover', 'ai apocalypse', 'skynet', 'terminator', 'killer robot',
  'existential risk', 'existential threat', 'x-risk', 'extinction',
  'ai revolution', 'ai breakthrough', 'game over', 'changes everything',
  'mind-blowing', 'insane', 'crazy'
];

const termCounts: Record<string, { left: number; center: number; right: number }> = {};
for (const term of aiTerms) {
  termCounts[term] = { left: 0, center: 0, right: 0 };
}

const articlesWithTerms: { title: string; source: string; bias: string; terms: string[] }[] = [];

for (const article of articles) {
  const text = `${article.title} ${article.snippet || ''} ${article.content || ''}`.toLowerCase();
  const biasGroup = article.bias.includes('left') ? 'left' :
                    article.bias.includes('right') ? 'right' : 'center';

  const foundTerms: string[] = [];

  for (const term of aiTerms) {
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
  console.log('No AI-specific loaded terms found in article titles/snippets.');
  console.log('\nThis is expected - most AI coverage uses neutral language in headlines.');
  console.log('Loaded terms like "AI doomer" appear more in opinion pieces and social media.\n');
} else {
  console.log('DETECTED AI LOADED TERMS:');
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

// Show sample AI headlines
console.log('\n📰 SAMPLE AI HEADLINES (checking for neutral vs loaded):');
console.log('─'.repeat(60));

for (const article of articles.slice(0, 15)) {
  const biasIcon = article.bias.includes('left') ? '◀' : article.bias.includes('right') ? '▶' : '●';

  // Check if any AI loaded terms
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

// Count total AI terms in database
const totalTerms = Object.keys(LOADED_TERMS).filter(t =>
  t.includes('ai ') || t.includes(' ai') || t.includes('agi') ||
  t.includes('doomer') || t.includes('singularity') || t.includes('sentient') ||
  t.includes('superintelligence') || t.includes('robot') || t.includes('algorithm')
).length;

console.log('📊 AI TERM DICTIONARY STATS:');
console.log('─'.repeat(60));
console.log(`  Total AI-specific loaded terms: ${totalTerms}`);
console.log('  Categories: dismissive-of-safety (R), critical-of-industry (L), sensational (S)');

db.close();
