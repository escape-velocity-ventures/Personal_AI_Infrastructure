#!/usr/bin/env bun
/**
 * pai-memory setup
 *
 * Initializes schema, tests connections, and verifies Ollama embedding model.
 *
 * Usage:
 *   PG_URL=postgresql://... REDIS_URL=redis://... bun run setup.ts
 *   bun run setup.ts --check   # test connections only, no schema changes
 */

import { Pool } from 'pg';
import { createClient } from 'redis';

const PG_URL    = process.env.PG_URL    ?? process.env.PGURL    ?? '';
const REDIS_URL = process.env.REDIS_URL ?? process.env.REDISURL ?? '';
const OLLAMA    = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const CHECK_ONLY = Bun.argv.includes('--check');

const SCHEMA = `
-- pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Memory Chunks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content      text NOT NULL,
  embedding    vector(768) NOT NULL,
  source_type  text NOT NULL,
  source_path  text,
  source_hash  text,
  chunk_index  smallint NOT NULL DEFAULT 0,
  memory_type  text NOT NULL,
  tags         text[] DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  accessed_at  timestamptz,
  access_count integer DEFAULT 0,
  decay_class  text NOT NULL DEFAULT 'standard',
  expires_at   timestamptz,
  session_id   text,
  agent_id     text NOT NULL DEFAULT 'main',
  visibility   text NOT NULL DEFAULT 'shared'
);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding   ON memory_chunks USING ivfflat(embedding vector_cosine_ops) WITH (lists=50);
CREATE INDEX IF NOT EXISTS idx_chunks_fts         ON memory_chunks USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_chunks_tags        ON memory_chunks USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_chunks_memory_type ON memory_chunks(memory_type);
CREATE INDEX IF NOT EXISTS idx_chunks_source_path ON memory_chunks(source_path);
CREATE INDEX IF NOT EXISTS idx_chunks_created     ON memory_chunks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_decay       ON memory_chunks(decay_class, expires_at) WHERE expires_at IS NOT NULL;

-- ─── Entities ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  entity_type       text NOT NULL,
  summary           text,
  summary_embedding vector(768),
  metadata          jsonb DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

-- ─── Chunk Entity Refs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chunk_entity_refs (
  chunk_id     uuid NOT NULL REFERENCES memory_chunks(id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship text DEFAULT 'mentions',
  PRIMARY KEY (chunk_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_cer_entity ON chunk_entity_refs(entity_id);

-- ─── Ingestion Sources ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_sources (
  source_path   text PRIMARY KEY,
  last_hash     text NOT NULL,
  last_ingested timestamptz NOT NULL DEFAULT NOW(),
  chunk_count   integer NOT NULL DEFAULT 0
);

-- ─── Command Log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS command_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      text NOT NULL DEFAULT 'main',
  session_id    text NOT NULL,
  machine_id    text,
  project_path  text,
  git_branch    text,
  ts            timestamptz NOT NULL,
  tool_name     text NOT NULL,
  command_text  text NOT NULL,
  description   text,
  user_prompt   text,
  reasoning     text,
  outcome       text CHECK (outcome IN ('success','error','blocked','unknown')),
  result_text   text,
  exit_code     int,
  embedding     vector(768)
);
CREATE INDEX IF NOT EXISTS idx_cmdlog_ts      ON command_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_cmdlog_session ON command_log(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cmdlog_agent   ON command_log(agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cmdlog_tool    ON command_log(tool_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cmdlog_machine ON command_log(machine_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cmdlog_embed   ON command_log USING ivfflat(embedding vector_cosine_ops) WITH (lists=50);
CREATE INDEX IF NOT EXISTS idx_cmdlog_fts     ON command_log USING gin(
  to_tsvector('english',
    command_text || ' ' || COALESCE(description,'') || ' ' ||
    COALESCE(reasoning,'') || ' ' || COALESCE(user_prompt,'')
  )
);
`;

async function main() {
  console.log('🔍 pai-memory setup\n');

  // ── Validate config ──
  let ok = true;
  if (!PG_URL)    { console.error('❌ PG_URL not set');    ok = false; }
  if (!REDIS_URL) { console.error('❌ REDIS_URL not set'); ok = false; }
  if (!ok) { console.error('\nSet PG_URL and REDIS_URL environment variables.'); process.exit(1); }

  // ── PostgreSQL ──
  process.stdout.write('  PostgreSQL... ');
  const pool = new Pool({ connectionString: PG_URL });
  try {
    await pool.query('SELECT 1');
    console.log('✓ connected');
  } catch (e) {
    console.error('✗', (e as Error).message); process.exit(1);
  }

  // ── Redis ──
  process.stdout.write('  Redis...      ');
  const redis = createClient({ url: REDIS_URL });
  redis.on('error', () => {});
  try {
    await redis.connect();
    const pong = await redis.ping();
    console.log(pong === 'PONG' ? '✓ connected' : '✗ unexpected response');
    await redis.disconnect();
  } catch (e) {
    console.error('✗', (e as Error).message); process.exit(1);
  }

  // ── Ollama ──
  process.stdout.write('  Ollama...     ');
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    const data = await res.json() as { models: { name: string }[] };
    const hasModel = data.models?.some(m => m.name.includes('nomic-embed'));
    if (hasModel) {
      console.log('✓ nomic-embed-text available');
    } else {
      console.log('⚠ connected but nomic-embed-text not found — run: ollama pull nomic-embed-text');
    }
  } catch {
    console.log('⚠ not reachable — embeddings will be unavailable');
  }

  if (CHECK_ONLY) {
    console.log('\n✅ Connection check complete.');
    await pool.end();
    return;
  }

  // ── Apply schema ──
  console.log('\n📐 Applying schema...');
  try {
    await pool.query(SCHEMA);
    console.log('✅ Schema ready.');
  } catch (e) {
    console.error('❌ Schema error:', (e as Error).message);
    await pool.end();
    process.exit(1);
  }

  // ── Summary ──
  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM memory_chunks)     AS chunks,
      (SELECT COUNT(*) FROM entities)          AS entities,
      (SELECT COUNT(*) FROM command_log)       AS commands,
      (SELECT COUNT(*) FROM ingestion_sources) AS sources
  `);
  const s = stats.rows[0];
  console.log(`\n📊 Database state:`);
  console.log(`   memory_chunks:     ${s.chunks}`);
  console.log(`   entities:          ${s.entities}`);
  console.log(`   command_log:       ${s.commands}`);
  console.log(`   ingestion_sources: ${s.sources}`);

  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
