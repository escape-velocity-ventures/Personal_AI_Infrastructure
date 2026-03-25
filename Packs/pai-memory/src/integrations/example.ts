#!/usr/bin/env bun

/**
 * Example: NanoClaw Bootstrap Hook Usage
 *
 * Demonstrates how to integrate Engram memory into NanoClaw sessions.
 */

import { bootstrapFromEngram, fetchBootstrapContext } from './nanoclaw-bootstrap';

// ─── Configuration ───────────────────────────────────────────────────────────

const ENGRAM_URL = process.env.ENGRAM_URL ?? 'http://localhost:3000';
const ENGRAM_TOKEN = process.env.ENGRAM_TOKEN ?? 'dev-token'; // In production: JWT
const NAMESPACE = 'development';

// ─── Example 1: Semantic Search Bootstrap ───────────────────────────────────

async function exampleSemanticBootstrap() {
  console.log('📚 Example 1: Semantic Search Bootstrap\n');

  const result = await bootstrapFromEngram({
    engramUrl: ENGRAM_URL,
    token: ENGRAM_TOKEN,
    namespace: NAMESPACE,
    query: 'kubernetes deployment patterns',
    limit: 5,
    minSimilarity: 0.6,
    tags: ['kubernetes'],
  });

  if (!result.available) {
    console.log('⚠️  Engram unavailable:', result.error);
    console.log('Continuing without memory context (graceful degradation)...\n');
    return;
  }

  if (result.count === 0) {
    console.log('ℹ️  No relevant memories found\n');
    return;
  }

  console.log(`✅ Retrieved ${result.count} relevant memories\n`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log(result.context);
  console.log('─────────────────────────────────────────────────────────────\n');
}

// ─── Example 2: Curated Bootstrap Context ───────────────────────────────────

async function exampleCuratedBootstrap() {
  console.log('📚 Example 2: Curated Bootstrap Context\n');

  const result = await fetchBootstrapContext(ENGRAM_URL, ENGRAM_TOKEN);

  if (!result.available) {
    console.log('⚠️  Engram unavailable:', result.error);
    console.log('Continuing without bootstrap context...\n');
    return;
  }

  if (result.count === 0) {
    console.log('ℹ️  No curated memories available\n');
    return;
  }

  console.log(`✅ Retrieved ${result.count} curated memories\n`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log(result.context.slice(0, 500)); // Show first 500 chars
  console.log('\n... (truncated for example)\n');
  console.log('─────────────────────────────────────────────────────────────\n');
}

// ─── Example 3: NanoClaw Integration Pattern ────────────────────────────────

interface NanoClawSession {
  userId: string;
  namespace: string;
  firstMessage: string;
  systemPrompt: string;
}

async function initializeNanoClawSession(
  userId: string,
  namespace: string,
  firstMessage: string
): Promise<NanoClawSession> {
  console.log('📚 Example 3: Full NanoClaw Session Initialization\n');
  console.log(`User: ${userId}`);
  console.log(`Namespace: ${namespace}`);
  console.log(`First message: "${firstMessage}"\n`);

  // Fetch memories based on first user message
  const memories = await bootstrapFromEngram({
    engramUrl: ENGRAM_URL,
    token: ENGRAM_TOKEN, // In production: generate JWT from userId
    namespace,
    query: firstMessage,
    limit: 10,
    minSimilarity: 0.5,
  });

  // Build system prompt with memory context
  const basePrompt = `You are a helpful AI assistant with access to organizational memory.`;

  let systemPrompt = basePrompt;
  if (memories.available && memories.count > 0) {
    systemPrompt += `\n\n---\n\n${memories.context}`;
    console.log(`✅ Injected ${memories.count} memories into system prompt\n`);
  } else {
    console.log('ℹ️  No memory context available\n');
  }

  const session: NanoClawSession = {
    userId,
    namespace,
    firstMessage,
    systemPrompt,
  };

  return session;
}

// ─── Run Examples ────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 NanoClaw Bootstrap Hook Examples\n');
  console.log(`Engram URL: ${ENGRAM_URL}`);
  console.log(`Namespace: ${NAMESPACE}\n`);
  console.log('═════════════════════════════════════════════════════════════\n');

  // Example 1: Semantic search
  await exampleSemanticBootstrap();

  // Example 2: Curated bootstrap
  await exampleCuratedBootstrap();

  // Example 3: Full session initialization
  const session = await initializeNanoClawSession(
    'user-123',
    'production',
    'How do I deploy a highly available Kubernetes cluster?'
  );

  console.log('Final session configuration:');
  console.log({
    userId: session.userId,
    namespace: session.namespace,
    promptLength: session.systemPrompt.length,
    hasMemoryContext: session.systemPrompt.includes('# Relevant Memories'),
  });
  console.log('\n✅ All examples complete\n');
}

// Run if executed directly
if (import.meta.main) {
  main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
}
