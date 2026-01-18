/**
 * Database Statistics - Coverage by Bias
 */

import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

const dbPath = join(homedir(), '.cache', 'pai-info-hygiene', 'hygiene.db');
const db = new Database(dbPath);

// Total articles by bias
const byBias = db.query(`
  SELECT bias, COUNT(*) as count
  FROM articles
  GROUP BY bias
  ORDER BY
    CASE bias
      WHEN 'left' THEN 1
      WHEN 'lean-left' THEN 2
      WHEN 'center' THEN 3
      WHEN 'lean-right' THEN 4
      WHEN 'right' THEN 5
    END
`).all() as { bias: string; count: number }[];

console.log('\n📊 COVERAGE BY BIAS RATING');
console.log('═══════════════════════════════════════');
const total = byBias.reduce((sum, r) => sum + r.count, 0);
for (const row of byBias) {
  const pct = ((row.count / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(row.count / 20));
  console.log(`  ${row.bias.padEnd(12)} ${String(row.count).padStart(4)} (${pct.padStart(5)}%) ${bar}`);
}
console.log(`  ${'─'.repeat(40)}`);
console.log(`  Total: ${total} articles`);

// By source type and bias
console.log('\n📊 COVERAGE BY SOURCE TYPE');
console.log('═══════════════════════════════════════');
const byType = db.query(`
  SELECT source_type, bias, COUNT(*) as count
  FROM articles
  GROUP BY source_type, bias
  ORDER BY source_type,
    CASE bias
      WHEN 'left' THEN 1
      WHEN 'lean-left' THEN 2
      WHEN 'center' THEN 3
      WHEN 'lean-right' THEN 4
      WHEN 'right' THEN 5
    END
`).all() as { source_type: string; bias: string; count: number }[];

let currentType = '';
for (const row of byType) {
  if (row.source_type !== currentType) {
    currentType = row.source_type;
    console.log(`\n  ${currentType.toUpperCase()}`);
  }
  console.log(`    ${row.bias.padEnd(12)} ${String(row.count).padStart(4)}`);
}

// Top sources
console.log('\n📊 TOP 15 SOURCES BY ARTICLE COUNT');
console.log('═══════════════════════════════════════');
const topSources = db.query(`
  SELECT source_name, bias, COUNT(*) as count
  FROM articles
  GROUP BY source_name
  ORDER BY count DESC
  LIMIT 15
`).all() as { source_name: string; bias: string; count: number }[];

for (const row of topSources) {
  console.log(`  ${row.source_name.padEnd(28)} ${row.bias.padEnd(12)} ${row.count}`);
}

// Balance score
console.log('\n📊 BALANCE ANALYSIS');
console.log('═══════════════════════════════════════');
const leftCount = byBias.filter(r => r.bias === 'left' || r.bias === 'lean-left').reduce((s, r) => s + r.count, 0);
const rightCount = byBias.filter(r => r.bias === 'right' || r.bias === 'lean-right').reduce((s, r) => s + r.count, 0);
const centerCount = byBias.filter(r => r.bias === 'center').reduce((s, r) => s + r.count, 0);

console.log(`  Left + Lean-Left:   ${leftCount} (${((leftCount/total)*100).toFixed(1)}%)`);
console.log(`  Center:             ${centerCount} (${((centerCount/total)*100).toFixed(1)}%)`);
console.log(`  Right + Lean-Right: ${rightCount} (${((rightCount/total)*100).toFixed(1)}%)`);
console.log(`  Left/Right Ratio:   ${(leftCount/rightCount).toFixed(2)}`);

if (leftCount > rightCount * 1.5) {
  console.log('\n  ⚠️  Coverage skews LEFT - consider adding more right sources');
} else if (rightCount > leftCount * 1.5) {
  console.log('\n  ⚠️  Coverage skews RIGHT - consider adding more left sources');
} else {
  console.log('\n  ✓ Coverage is reasonably balanced');
}

db.close();
