# Plan: Remote MCP Transport for Engram

## Context

The Engram MCP server (`src/mcp-server.ts`) uses stdio transport, which works for Claude Code and Claude Desktop but not claude.ai. Claude's web interface requires a remote MCP server over HTTP (Streamable HTTP protocol). The Engram HTTP API is already publicly deployed at `memory-api.escape-velocity-ventures.org` on Hono — we just need to mount a `/mcp` route using the SDK's `WebStandardStreamableHTTPServerTransport`.

## Approach

Extract the 10 tools + 2 resources into a shared factory (`src/mcp-tools.ts`), then wire it to both transports: stdio (existing) and Streamable HTTP (new route in `server.ts`). Auth tokens flow from the remote MCP request through to the API's own auth middleware via the SDK's `extra.authInfo` mechanism.

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/mcp-tools.ts` | **Create** | Factory function with all 10 tools + 2 resources |
| `src/mcp-server.ts` | **Rewrite** | Slim to ~15 lines: import factory, connect stdio |
| `src/server.ts` | **Edit** | Add `/mcp` route + update CORS headers |
| `src/auth.ts` | **Edit** | Add `/mcp` to `PUBLIC_PATHS` |

## Implementation Details

### 1. `src/mcp-tools.ts` (new)

Export a factory that creates and configures an `McpServer`:

```typescript
export function createMcpServer(apiUrl: string, defaultToken: string): McpServer
```

- Internal `api(path, token, opts)` fetch helper — same as today but accepts per-call token
- Each tool callback uses `extra.authInfo?.token ?? defaultToken` for the Bearer token
- Resources also receive `extra` and use the same token pattern
- All 10 tools + 2 resources move here verbatim, with the token change

### 2. `src/mcp-server.ts` (rewrite)

Slim down to:
- Import `createMcpServer` from `./mcp-tools.js`
- Read `ENGRAM_API_URL` and `ENGRAM_API_KEY` from env
- Create server, connect `StdioServerTransport`, log startup

### 3. `src/server.ts` (edit)

**Add imports:**
```typescript
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './mcp-tools.js';
```

**Update CORS** — expose MCP protocol headers:
```typescript
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'],
  exposeHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
}));
```

**Add `/mcp` route** — stateless, per-request transport:
```typescript
app.all('/mcp', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';

  const transport = new WebStandardStreamableHTTPServerTransport();
  const mcpServer = createMcpServer(`http://localhost:${port}`, token);
  await mcpServer.connect(transport);

  return transport.handleRequest(c.req.raw, {
    authInfo: { token, clientId: 'remote', scopes: [] },
  });
});
```

### 4. `src/auth.ts` (edit)

Add `/mcp` to `PUBLIC_PATHS` so the auth middleware skips it. The MCP tools handle auth themselves — they call the HTTP API with the forwarded Bearer token, which re-enters auth middleware on those internal requests.

```typescript
const PUBLIC_PATHS = ['/health', '/ready', '/metrics', '/mcp'];
```

## Auth Flow

```
claude.ai  ──Bearer token──▶  /mcp route (skips auth middleware)
                                │
                                ▼
                            MCP transport parses JSON-RPC
                                │
                            tool callback receives extra.authInfo.token
                                │
                                ▼
                            fetch("localhost:3000/search", Bearer token)
                                │
                            auth middleware validates token ✓
                                │
                                ▼
                            MemoryClient → pgvector/Redis
```

## Verification

1. **Stdio regression** — `ENGRAM_API_URL=... ENGRAM_API_KEY=... bun run src/mcp-server.ts` still starts
2. **Remote MCP startup** — `bun run src/server.ts` starts without errors
3. **MCP initialize** — `curl -X POST .../mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","method":"initialize","params":{...},"id":1}'`
4. **Tool call** — Send a `tools/call` for `engram_search` and verify it returns results
5. **Auth enforcement** — Verify that calling without a token returns auth errors from the underlying API
