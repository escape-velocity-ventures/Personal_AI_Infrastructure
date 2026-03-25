/**
 * Tests for NanoClaw bootstrap hook
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { bootstrapFromEngram, fetchBootstrapContext } from './nanoclaw-bootstrap';
import type { MemoryChunk } from '../types';

// ─── Mock Server ─────────────────────────────────────────────────────────────

let mockServer: ReturnType<typeof Bun.serve> | null = null;
const TEST_PORT = 9876;
const TEST_URL = `http://localhost:${TEST_PORT}`;

// Mock response data
const MOCK_MEMORIES: MemoryChunk[] = [
  {
    id: '1',
    content: 'Kubernetes deployments use rolling updates by default.',
    sourcePath: 'k8s/deployment-patterns.md',
    sourceType: 'git_repo',
    memoryType: 'semantic',
    tags: ['kubernetes', 'deployment'],
    agentId: 'test',
    visibility: 'shared',
    decayClass: 'standard',
    createdAt: new Date('2026-03-20'),
    similarity: 0.87,
  },
  {
    id: '2',
    content: 'NetworkPolicies block all ingress by default.',
    sourcePath: 'k8s/network-policies.md',
    sourceType: 'git_repo',
    memoryType: 'semantic',
    tags: ['kubernetes', 'networking'],
    agentId: 'test',
    visibility: 'shared',
    decayClass: 'standard',
    createdAt: new Date('2026-03-21'),
    similarity: 0.72,
  },
];

beforeAll(() => {
  mockServer = Bun.serve({
    port: TEST_PORT,
    fetch(req) {
      const url = new URL(req.url);

      // Mock /search endpoint
      if (url.pathname === '/search' && req.method === 'POST') {
        return Response.json({
          results: MOCK_MEMORIES,
          count: MOCK_MEMORIES.length,
          query: 'test query',
        });
      }

      // Mock /bootstrap endpoint
      if (url.pathname === '/bootstrap' && req.method === 'GET') {
        return Response.json({
          chunks: MOCK_MEMORIES,
          count: MOCK_MEMORIES.length,
        });
      }

      // Mock error endpoint
      if (url.pathname === '/error') {
        return new Response('Internal Server Error', { status: 500 });
      }

      return new Response('Not Found', { status: 404 });
    },
  });
});

afterAll(() => {
  mockServer?.stop();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('bootstrapFromEngram', () => {
  test('fetches and formats memories successfully', async () => {
    const result = await bootstrapFromEngram({
      engramUrl: TEST_URL,
      token: 'test-token',
      namespace: 'test-namespace',
      query: 'kubernetes deployment',
      limit: 10,
    });

    expect(result.available).toBe(true);
    expect(result.count).toBe(2);
    expect(result.error).toBeUndefined();
    expect(result.context).toContain('# Relevant Memories (2)');
    expect(result.context).toContain('kubernetes');
    expect(result.context).toContain('deployment-patterns.md');
    expect(result.context).toContain('**Similarity:** 0.87');
  });

  test('handles empty results gracefully', async () => {
    // Create a temporary mock that returns empty results
    const emptyServer = Bun.serve({
      port: TEST_PORT + 1,
      fetch() {
        return Response.json({ results: [], count: 0 });
      },
    });

    const result = await bootstrapFromEngram({
      engramUrl: `http://localhost:${TEST_PORT + 1}`,
      token: 'test-token',
      namespace: 'test-namespace',
      query: 'nonexistent topic',
    });

    expect(result.available).toBe(true);
    expect(result.count).toBe(0);
    expect(result.context).toBe('');
    expect(result.error).toBeUndefined();

    emptyServer.stop();
  });

  test('handles Engram unavailability gracefully', async () => {
    const result = await bootstrapFromEngram({
      engramUrl: 'http://localhost:9999', // Non-existent server
      token: 'test-token',
      namespace: 'test-namespace',
      query: 'test query',
    });

    expect(result.available).toBe(false);
    expect(result.count).toBe(0);
    expect(result.context).toBe('');
    expect(result.error).toBeDefined();
  });

  test('handles API errors gracefully', async () => {
    // Test with a non-existent endpoint that returns 404
    const errorServer = Bun.serve({
      port: TEST_PORT + 3,
      fetch() {
        return new Response('Server Error', { status: 500 });
      },
    });

    const errorResult = await bootstrapFromEngram({
      engramUrl: `http://localhost:${TEST_PORT + 3}`,
      token: 'test-token',
      namespace: 'test-namespace',
      query: 'test query',
    });

    expect(errorResult.available).toBe(false);
    expect(errorResult.context).toBe('');
    expect(errorResult.error).toContain('500');

    errorServer.stop();
  });

  test(
    'respects timeout (5 seconds)',
    async () => {
      const slowServer = Bun.serve({
        port: TEST_PORT + 2,
        async fetch() {
          // Delay longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return Response.json({ results: [] });
        },
      });

      const start = Date.now();
      const result = await bootstrapFromEngram({
        engramUrl: `http://localhost:${TEST_PORT + 2}`,
        token: 'test-token',
        namespace: 'test-namespace',
        query: 'test query',
      });
      const duration = Date.now() - start;

      expect(result.available).toBe(false);
      expect(duration).toBeLessThan(8000); // Should timeout before server responds
      // Bun uses "timed out" instead of "abort" in error message
      expect(result.error).toMatch(/timed out|abort/i);

      slowServer.stop();
    },
    { timeout: 8000 }
  ); // Test timeout > request timeout

  test('formats context with all metadata fields', async () => {
    const result = await bootstrapFromEngram({
      engramUrl: TEST_URL,
      token: 'test-token',
      namespace: 'production',
      query: 'kubernetes',
    });

    const ctx = result.context;

    // Check structure
    expect(ctx).toContain('# Relevant Memories');
    expect(ctx).toContain('## Memory 1');
    expect(ctx).toContain('## Memory 2');

    // Check metadata
    expect(ctx).toContain('**Source:**');
    expect(ctx).toContain('**Type:**');
    expect(ctx).toContain('**Created:**');
    expect(ctx).toContain('**Similarity:**');

    // Check content
    expect(ctx).toContain('rolling updates');
    expect(ctx).toContain('NetworkPolicies');

    // Check separator
    expect(ctx).toContain('---');
  });
});

describe('fetchBootstrapContext', () => {
  test('fetches bootstrap memories successfully', async () => {
    const result = await fetchBootstrapContext(TEST_URL, 'test-token');

    expect(result.available).toBe(true);
    expect(result.count).toBe(2);
    expect(result.context).toContain('# Bootstrap Context');
    expect(result.context).toContain('curated memories');
  });

  test('handles bootstrap unavailability gracefully', async () => {
    const result = await fetchBootstrapContext(
      'http://localhost:9999',
      'test-token'
    );

    expect(result.available).toBe(false);
    expect(result.count).toBe(0);
    expect(result.context).toBe('');
    expect(result.error).toBeDefined();
  });

  test('formats bootstrap context simply', async () => {
    const result = await fetchBootstrapContext(TEST_URL, 'test-token');

    const ctx = result.context;

    // Bootstrap format is simpler than search results
    expect(ctx).toContain('# Bootstrap Context');
    expect(ctx).toContain('###'); // Section headers
    expect(ctx).not.toContain('**Similarity:**'); // No similarity in bootstrap
  });
});
