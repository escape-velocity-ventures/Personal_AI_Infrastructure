#!/usr/bin/env bun
/**
 * MCP Server for Unified Calendar
 * Provides calendar aggregation across multiple sources
 */

import { unifiedCalendarTools, handleUnifiedCalendarTool } from './tools';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

async function handleRequest(request: MCPRequest): Promise<MCPResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'pai-unified-calendar',
              version: '1.0.0',
            },
            capabilities: {
              tools: {},
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: unifiedCalendarTools,
          },
        };

      case 'tools/call': {
        const { name, arguments: args } = params as {
          name: string;
          arguments: Record<string, unknown>;
        };

        const result = await handleUnifiedCalendarTool(name, args || {});

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

// Main server loop (stdio transport)
async function main() {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);

    // Process complete JSON-RPC messages
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line) as MCPRequest;
        const response = await handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        console.log(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: 'Parse error',
            },
          })
        );
      }
    }
  }
}

main().catch(console.error);
