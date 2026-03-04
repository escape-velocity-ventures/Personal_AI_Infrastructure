#!/usr/bin/env bun
/**
 * Entity Extraction Pipeline
 *
 * Extracts named entities from memory_chunks and populates:
 *   - entities (id, name, entity_type, summary, summary_embedding)
 *   - chunk_entity_refs (chunk_id, entity_id, relationship)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run extract-entities.ts [--all] [--tags tag1,tag2] [--dry-run]
 *
 * Defaults to processing 'curated' and 'research' tagged chunks.
 * Use --all to process every chunk (expensive, ~3800 Claude calls).
 */

import { Pool } from 'pg';

// ─── Config ────────────────────────────────────────────────────────────────

const PG_URL = 'postgresql://memory:memory-ev-2026@192.168.4.124:5432/memory';
const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
const EMBEDDING_MODEL = 'nomic-embed-text';
const BATCH_SIZE = 10;
const RATE_LIMIT_MS = 200; // delay between Claude calls

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExtractedEntity {
  name: string;
  entity_type: 'person' | 'project' | 'infrastructure' | 'concept' | 'incident' | 'decision' | 'tool';
  summary: string;
  relationship: string;
}

interface Chunk {
  id: string;
  content: string;
  source_path: string | null;
  tags: string[];
  memory_type: string;
}

// ─── CLI Args ───────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const processAll = args.includes('--all');
const dryRun = args.includes('--dry-run');
const tagsArg = args.find(a => a.startsWith('--tags='))?.split('=')[1];
const filterTags = tagsArg ? tagsArg.split(',') : ['curated', 'research', 'memory-md'];

// ─── Anthropic Extraction ────────────────────────────────────────────────────

async function extractEntities(chunk: Chunk, apiKey: string): Promise<ExtractedEntity[]> {
  const sourceHint = chunk.source_path ? `\nSource: ${chunk.source_path}` : '';
  const tagHint = chunk.tags.length ? `\nTags: ${chunk.tags.join(', ')}` : '';

  const prompt = `Extract named entities from this text. Return a JSON array only, no other text.

For each entity return:
- "name": canonical name (e.g. "TinkerBelle", "plato-k3s", "Benjamin", "deploy-guard")
- "entity_type": one of: person | project | infrastructure | concept | incident | decision | tool
- "summary": 1-2 sentence description of what this entity is
- "relationship": how this chunk relates to the entity, one of:
  describes | mentions | documents_incident | defines_decision | authored_by | implemented_in | depends_on

Only extract NAMED, SPECIFIC entities (not generic terms like "database" or "agent").
Prefer well-known names over generic descriptions.
Return [] if no clear named entities.${sourceHint}${tagHint}

Text:
${chunk.content.slice(0, 3000)}`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { content: { type: string; text: string }[] };
  const text = data.content.find(c => c.type === 'text')?.text ?? '[]';

  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const parsed = JSON.parse(json) as ExtractedEntity[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`  ⚠ JSON parse failed for chunk ${chunk.id}, skipping`);
    return [];
  }
}

// ─── Embedding Generation ────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, 4000) }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  } catch {
    return null;
  }
}

// ─── Database Helpers ────────────────────────────────────────────────────────

async function upsertEntity(
  pool: Pool,
  entity: ExtractedEntity,
  embedding: number[] | null
): Promise<string> {
  const embeddingVal = embedding ? `[${embedding.join(',')}]` : null;

  const result = await pool.query<{ id: string }>(`
    INSERT INTO entities (name, entity_type, summary, summary_embedding, metadata)
    VALUES ($1, $2, $3, $4::vector, $5)
    ON CONFLICT (name) DO UPDATE SET
      summary = CASE
        WHEN excluded.summary != '' THEN excluded.summary
        ELSE entities.summary
      END,
      summary_embedding = COALESCE(excluded.summary_embedding, entities.summary_embedding),
      updated_at = NOW()
    RETURNING id
  `, [entity.name, entity.entity_type, entity.summary, embeddingVal, JSON.stringify({ type: entity.entity_type })]);

  return result.rows[0].id;
}

async function linkChunkToEntity(
  pool: Pool,
  chunkId: string,
  entityId: string,
  relationship: string
): Promise<void> {
  await pool.query(`
    INSERT INTO chunk_entity_refs (chunk_id, entity_id, relationship)
    VALUES ($1, $2, $3)
    ON CONFLICT (chunk_id, entity_id) DO NOTHING
  `, [chunkId, entityId, relationship]);
}

async function getAlreadyProcessedChunkIds(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ chunk_id: string }>(`
    SELECT DISTINCT chunk_id FROM chunk_entity_refs
  `);
  return new Set(result.rows.map(r => r.chunk_id));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !dryRun) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is required');
    console.error('   Usage: ANTHROPIC_API_KEY=sk-... bun run extract-entities.ts');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: PG_URL });

  try {
    // Fetch chunks to process
    let chunkQuery: string;
    let chunkParams: unknown[];

    if (processAll) {
      console.log('📦 Mode: processing ALL chunks');
      chunkQuery = `SELECT id, content, source_path, tags, memory_type FROM memory_chunks ORDER BY created_at DESC`;
      chunkParams = [];
    } else {
      console.log(`📦 Mode: processing chunks tagged with: ${filterTags.join(', ')}`);
      // Match any of the filter tags
      chunkQuery = `
        SELECT id, content, source_path, tags, memory_type
        FROM memory_chunks
        WHERE tags && $1::text[]
        ORDER BY created_at DESC
      `;
      chunkParams = [filterTags];
    }

    const chunksResult = await pool.query<Chunk>(chunkQuery, chunkParams);
    const allChunks = chunksResult.rows;
    console.log(`📊 Total chunks to consider: ${allChunks.length}`);

    // Skip already-processed chunks
    const processed = await getAlreadyProcessedChunkIds(pool);
    const chunks = allChunks.filter(c => !processed.has(c.id));
    console.log(`⏭  Already processed: ${processed.size} | Remaining: ${chunks.length}`);

    if (chunks.length === 0) {
      console.log('✅ Nothing new to process.');
      return;
    }

    if (dryRun) {
      console.log('\n🔍 Dry run — showing first 3 chunks that would be processed:');
      for (const c of chunks.slice(0, 3)) {
        console.log(`  ${c.id} | [${c.tags.join(', ')}] | ${c.source_path ?? 'no path'}`);
        console.log(`  ${c.content.slice(0, 120).replace(/\n/g, ' ')}...`);
      }
      return;
    }

    // Process in batches
    let totalEntities = 0;
    let totalRefs = 0;
    let errorCount = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

      process.stdout.write(`\r🔄 Batch ${batchNum}/${totalBatches} (${i + batch.length}/${chunks.length} chunks)...`);

      for (const chunk of batch) {
        try {
          const extracted = await extractEntities(chunk, apiKey);

          for (const entity of extracted) {
            if (!entity.name || !entity.entity_type) continue;

            const embedding = await generateEmbedding(`${entity.name}: ${entity.summary}`);
            const entityId = await upsertEntity(pool, entity, embedding);
            await linkChunkToEntity(pool, chunk.id, entityId, entity.relationship || 'mentions');

            totalEntities++;
            totalRefs++;
          }

          await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
        } catch (err) {
          errorCount++;
          if (errorCount <= 5) {
            console.error(`\n  ❌ Chunk ${chunk.id}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }

    console.log('\n');
    console.log('✅ Extraction complete!');
    console.log(`   Entity upserts:    ${totalEntities}`);
    console.log(`   Chunk→entity refs: ${totalRefs}`);
    if (errorCount > 0) console.log(`   Errors:            ${errorCount}`);

    // Summary of what's now in the entities table
    const summary = await pool.query<{ entity_type: string; count: string }>(`
      SELECT entity_type, COUNT(*) as count
      FROM entities
      GROUP BY entity_type
      ORDER BY count DESC
    `);

    console.log('\n📈 Entity table summary:');
    for (const row of summary.rows) {
      console.log(`   ${row.entity_type.padEnd(20)} ${row.count}`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
