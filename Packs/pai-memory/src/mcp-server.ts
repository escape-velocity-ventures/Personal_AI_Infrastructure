#!/usr/bin/env bun
/**
 * Engram MCP Server — Stdio Transport
 *
 * Usage:
 *   ENGRAM_API_URL=https://memory-api.example.com ENGRAM_API_KEY=<key> bun run src/mcp-server.ts
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-tools.js';

const API_URL = process.env.ENGRAM_API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.ENGRAM_API_KEY ?? '';

const server = createMcpServer(API_URL, API_KEY);
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Engram MCP server started');
console.error(`  API: ${API_URL}`);
console.error(`  Auth: ${API_KEY ? 'Bearer token configured' : 'none'}`);
