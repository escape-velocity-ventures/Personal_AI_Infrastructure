# pai-memory

Shared memory and intelligence management for PAI agents.

Provides persistent, searchable context that survives across sessions, machines, and agents — replacing ad-hoc file syncing with a proper queryable store.

## What it does

- **Semantic memory** — store and retrieve knowledge by meaning, not keyword
- **Entity graph** — named things (people, projects, tools, incidents) linked to the chunks that mention them
- **Command log** — flight recorder for every tool call an agent makes, with surrounding conversation context
- **Bootstrap cache** — fast cold-start context for a new agent session on any machine
- **Cross-agent pub/sub** — agents notify each other when new memories are written
- **Pattern detection** — find repeated command patterns that could be automated

## Architecture

```
pgvector (PostgreSQL 17 + pgvector extension)
  └── memory_chunks        — semantic/episodic/procedural memory with 768-dim embeddings
  └── entities             — named entity graph with summary embeddings
  └── chunk_entity_refs    — chunk ↔ entity links with relationship type
  └── command_log          — agent tool calls with context and outcome
  └── ingestion_sources    — deduplication tracking for file/session ingestion

Redis
  └── bootstrap:{agentId}  — cached cold-start context (TTL: 5 min)
  └── session:{sessionId}  — ephemeral session scratchpad (TTL: 24h)
  └── pub/sub channels:
        memory:new                  — new chunk written
        memory:bootstrap-invalidated — bootstrap cache cleared
        memory:command-ran          — command logged
```

Embeddings use `nomic-embed-text` (768-dim) via Ollama running locally.

---

## Quick Start (local)

### 1. Prerequisites

- [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/)
- [Bun](https://bun.sh/) runtime
- [Ollama](https://ollama.ai/) with `nomic-embed-text` model

```bash
ollama pull nomic-embed-text
```

### 2. Start the database and cache

```bash
cd pai-memory
docker compose up -d
```

Or with a custom password:
```bash
MEMORY_DB_PASSWORD=mypassword docker compose up -d
```

### 3. Initialize the schema

```bash
PG_URL=postgresql://memory:changeme@localhost:5432/memory \
REDIS_URL=redis://localhost:6379 \
bun run src/setup.ts
```

### 4. Verify

```bash
PG_URL=... REDIS_URL=... bun run src/setup.ts --check
```

---

## HTTP API (Remote Agents)

Agents that can't connect directly to pgvector (different infrastructure, different network) can use the memory-api HTTP service instead. It exposes the full MemoryClient surface over REST.

**Base URL:** `https://memory-api.escape-velocity-ventures.org`

**Auth:** `Authorization: Bearer <MEMORY_API_KEY>` on all endpoints except `/health`, `/ready`, `/metrics`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness — `{ status, pg, redis }` |
| `GET` | `/ready` | Readiness check |
| `GET` | `/stats` | Corpus counts — chunks, entities, commands |
| `GET` | `/bootstrap?agent=<id>` | Cold-start context for a session |
| `POST` | `/search` | Semantic / full-text / hybrid search |
| `POST` | `/remember` | Write a new memory chunk |
| `GET` | `/entity/:name` | Entity summary + metadata |
| `GET` | `/entity/:name/chunks` | All chunks mentioning that entity |
| `POST` | `/commands` | Log a command (flight recorder) |
| `POST` | `/commands/search` | Semantic search over command history |
| `GET` | `/patterns?minCount=3&days=30` | Repeated command patterns |
| `GET` | `/session/:id` | Read ephemeral session scratchpad |
| `PUT` | `/session/:id` | Write ephemeral session scratchpad |

### Session Start

Call `/bootstrap` at the top of every session and inject the returned chunks into your system prompt:

```bash
curl -s https://memory-api.escape-velocity-ventures.org/bootstrap?agent=my-agent \
  -H "Authorization: Bearer $MEMORY_API_KEY" | jq '.chunks[].content'
```

### Search

```json
POST /search
{
  "query": "what do we know about the SD530 servers?",
  "mode": "hybrid",
  "limit": 10,
  "memoryType": "semantic",
  "tags": ["infrastructure"]
}
```

`mode` options: `vector` (embedding similarity), `fts` (full-text), `hybrid` (default, both merged).

### Remember

```json
POST /remember
{
  "content": "The SD530 nodes support 768GB RAM across 12 DIMM slots.",
  "memoryType": "semantic",
  "tags": ["hardware", "sd530"],
  "visibility": "shared",
  "decayClass": "long-term"
}
```

`visibility`: `shared` (readable by all agents) or `private` (owner only).
`decayClass`: `long-term`, `standard`, or `ephemeral`.

### Command Log

```json
POST /commands
{
  "toolName": "Bash",
  "commandText": "kubectl rollout restart deployment/harmony",
  "sessionId": "abc123",
  "agentId": "my-agent",
  "outcome": "success"
}
```

### Session Scratchpad

```bash
# Write
curl -X PUT https://memory-api.escape-velocity-ventures.org/session/my-session \
  -H "Authorization: Bearer $MEMORY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"currentTask": "deploy harmony", "step": 2}'

# Read
curl https://memory-api.escape-velocity-ventures.org/session/my-session \
  -H "Authorization: Bearer $MEMORY_API_KEY"
```

Default TTL is 7 days. Pass `?ttl=<seconds>` to override.

### Importing Session Logs (Claude Code)

Claude Code writes JSONL session files to `~/.claude/projects/<project>/`. Each file contains every tool call, result, and conversation turn from a session. Importing these populates `command_log` with your full agent history, which powers `/patterns` and `/commands/search`.

**Remote agents (HTTP API only):** Parse the JSONL yourself and POST each tool call:

```typescript
import { readFileSync } from 'fs';

const API = 'https://memory-api.escape-velocity-ventures.org';
const KEY = process.env.MEMORY_API_KEY;

const lines = readFileSync('~/.claude/projects/my-project/session.jsonl', 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

for (const line of lines) {
  if (line.type !== 'tool_use') continue;
  await fetch(`${API}/commands`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId:     'my-agent',
      sessionId:   line.session_id,
      toolName:    line.name,
      commandText: line.input?.command ?? JSON.stringify(line.input),
      ts:          line.timestamp ?? new Date().toISOString(),
    }),
  });
}
```

**Direct DB access (TypeScript client):** Use the `ingest-sessions.ts` tool — it handles deduplication, result parsing, and conversation context automatically:

```bash
bun run ../Tools/ingest-sessions.ts --machine=my-machine --agent=my-agent
```

Safe to re-run — already-ingested sessions are skipped via `ingestion_sources`.

### Bulk-Loading Knowledge (HTTP API)

For loading existing documents, notes, or structured knowledge bases:

```typescript
const memories = [
  { content: 'pgvector runs on PostgreSQL 17 with the pgvector extension.',
    tags: ['database', 'infrastructure'], memoryType: 'semantic', decayClass: 'long-term' },
  { content: 'We use nomic-embed-text for 768-dim embeddings via Ollama.',
    tags: ['embeddings', 'ollama'], memoryType: 'semantic', decayClass: 'long-term' },
  // ...
];

for (const mem of memories) {
  await fetch(`${API}/remember`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mem),
  });
}
```

**Chunking guidance:** Break long documents at natural boundaries (paragraphs, sections) — each chunk should be self-contained enough to be useful when returned alone by search. 200–500 words per chunk is a good target. The embedding model has a 512-token context window; content beyond that is truncated.

**What to tag:** Tags are free-form strings used to filter search results. Good candidates: project name, topic area, source type (`conversation`, `document`, `decision`, `incident`), and people involved.

**Decay classes:**
- `long-term` — persists indefinitely (architecture decisions, facts, reference material)
- `standard` — default, subject to future pruning
- `ephemeral` — short-lived context (current task state, scratch notes)

---

## Cluster Deployment (k8s)

If you're running a k8s cluster, the k8s manifests belong in your cluster config repo rather than here. The schema and tooling in this pack are cluster-agnostic.

Reference manifests for pgvector and Redis StatefulSets are available at:
`https://github.com/escape-velocity-ventures/TinkerBelle-config` (private)

The key requirements:
- `pgvector/pgvector:pg17` image
- `redis:7.4-alpine` image (no sidecars needed — Redis is cache/pub/sub only)
- A LoadBalancer service if agents run on different machines than the cluster
- `local-path` or equivalent storage class pinned to a single node (pgvector doesn't need HA)

---

## Usage in an Agent

```typescript
import { MemoryClient } from 'pai-memory';

const mem = new MemoryClient({
  pgUrl:    'postgresql://memory:changeme@localhost:5432/memory',
  redisUrl: 'redis://localhost:6379',
  agentId:  'my-agent',        // namespaces your writes
});

await mem.connect();

// ── Cold start: get context for this session
const context = await mem.bootstrap();

// ── Remember something
await mem.remember('Decided to use pgvector instead of Chroma', {
  memoryType: 'semantic',
  tags: ['architecture', 'decision'],
});

// ── Search by meaning
const results = await mem.search('vector database decision');

// ── Look up everything about an entity
const chunks = await mem.getEntityChunks('TinkerBelle');

// ── Log a command (flight recorder)
await mem.logCommand({
  sessionId:   'abc123',
  toolName:    'Bash',
  commandText: 'kubectl rollout restart deployment/harmony',
  description: 'Restart harmony after config change',
  userPrompt:  'restart harmony',
  outcome:     'success',
  resultText:  'deployment.apps/harmony restarted',
});

// ── Find automation candidates
const patterns = await mem.findPatterns({ minCount: 3 });

// ── React to another agent's new memory
mem.on('memory:new', (data) => {
  console.log('Agent wrote new memory:', data.preview);
});

// ── Session scratchpad (ephemeral, Redis-backed)
await mem.setSessionState('abc123', { currentTask: 'deploy harmony', step: 2 });
```

---

## Ingesting Session Logs

Claude Code writes JSONL session files to `~/.claude/projects/`. The ingestion script parses these and populates `command_log` with every tool call, its result, and the surrounding conversation context.

```bash
# Ingest your local sessions
bun run src/setup.ts   # first run
bun run ../Tools/ingest-sessions.ts --machine=laptop --agent=my-agent

# Ingest from a different machine (run on that machine)
bun run ../Tools/ingest-sessions.ts --machine=plato --agent=aurelia
```

Safe to re-run — already-ingested sessions are skipped via `ingestion_sources`.

---

## Entity Extraction

Populate the entity graph from existing memory chunks using Claude (requires `ANTHROPIC_API_KEY`):

```bash
# High-signal chunks only (curated, research, memory-md tags)
ANTHROPIC_API_KEY=sk-... bun run ../Tools/extract-entities.ts

# All chunks (more complete, more expensive)
ANTHROPIC_API_KEY=sk-... bun run ../Tools/extract-entities.ts --all

# Preview without writing
ANTHROPIC_API_KEY=sk-... bun run ../Tools/extract-entities.ts --dry-run
```

Uses `claude-haiku-4-5` for cost efficiency. Idempotent — re-running merges new entities rather than duplicating.

---

## Multi-Agent Setup

Each agent connects to the same pgvector DB and Redis instance. Coordination:

| Concern | Mechanism |
|---------|-----------|
| Read isolation | `visibility` field — `shared` (all agents) or `private` (owner only) |
| Write attribution | `agent_id` field on every chunk and command |
| Real-time notification | Redis pub/sub on `memory:new` |
| Bootstrap consistency | Redis TTL cache, invalidated on curated writes |
| Session state | Per-session Redis hash, 24h TTL |

Agents on different machines connect via the LoadBalancer service IP (or VPN/tunnel if not LAN-adjacent).

---

## Multi-Tenancy

PAI Memory supports multi-tenant isolation with PostgreSQL Row-Level Security (RLS). Users can belong to multiple tenants (organizations or personal workspaces), and memory chunks are scoped to tenants with fine-grained access control.

### Concepts

- **Users**: Individual people identified by handle (e.g., `benjamin`). Users can belong to multiple tenants.
- **Tenants**: Organizations (`type: organization`) or personal workspaces (`type: personal`). Each tenant has a unique slug (e.g., `escape-velocity`).
- **Members**: Users who belong to a tenant, with roles:
  - `owner` — full control over tenant, members, and data
  - `admin` — manage members and data
  - `member` — read/write data
  - `reader` — read-only access
- **Scopes**: Memory chunks have a scope within a tenant:
  - `personal` — private to the author
  - `org` — shared across the entire tenant
  - `team` — shared with a specific team (future)

### Migration

The multi-tenancy migration runs automatically when you run `setup.ts` if the `tenants` table doesn't exist. For existing databases:

```bash
# Run setup (applies migration if needed)
bun run src/setup.ts

# Backfill existing data into tenant structure
bun run src/migrations/backfill-tenants.ts
```

The backfill script:
1. Creates a personal tenant for each distinct `agent_id` in `memory_chunks`
2. Creates users for authors of chunks
3. Links chunks/commands/entities to the appropriate tenant
4. Preserves backward compatibility (NULL `tenant_id` is visible to all users during transition)

### Authentication

The memory API supports two authentication modes:

1. **API Key** (legacy): `Authorization: Bearer <MEMORY_API_KEY>`
2. **JWT** (multi-tenant): `Authorization: Bearer <JWT>`

JWTs contain user identity and tenant memberships. Set `MEMORY_JWT_SECRET` environment variable to enable JWT auth.

#### JWT Format

```json
{
  "sub": "benjamin",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenants": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "slug": "escape-velocity",
      "role": "owner"
    }
  ]
}
```

#### Generating a Test Token

```bash
MEMORY_JWT_SECRET=your-secret bun run -e "
  import { generateToken } from './src/jwt-utils';
  console.log(await generateToken('your-secret', {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    handle: 'benjamin',
    tenants: [{
      id: '660e8400-e29b-41d4-a716-446655440000',
      slug: 'escape-velocity',
      role: 'owner'
    }]
  }));
"
```

Or generate the secret:

```bash
openssl rand -base64 32
```

### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/me` | Current user profile and tenant memberships |
| `GET` | `/tenants` | List all tenants the user belongs to |
| `GET` | `/tenants/:slug` | Get tenant details |
| `GET` | `/tenants/:slug/members` | List tenant members (requires owner/admin) |
| `POST` | `/tenants/:slug/members` | Add a member (requires owner/admin) |
| `DELETE` | `/tenants/:slug/members/:userId` | Remove a member (requires owner) |
| `POST` | `/promote/:userId` | Promote user to tenant admin/owner |

### Scoped Queries

All existing endpoints (`/search`, `/remember`, `/entity`, etc.) automatically filter results by tenant membership. Set the `X-Tenant-Slug` header to specify which tenant context to use:

```bash
curl -H "Authorization: Bearer $JWT" \
     -H "X-Tenant-Slug: escape-velocity" \
     https://memory-api.escape-velocity-ventures.org/search \
     -d '{"query": "kubernetes deployment"}'
```

If `X-Tenant-Slug` is omitted, the user's `default_tenant_id` is used.

### Row-Level Security (RLS)

RLS policies enforce tenant isolation at the database level. Even with direct database access, users can only see data in their tenants. Key policies:

- `memory_chunks`: Users see chunks in their tenants + NULL `tenant_id` (backward compat)
- `command_log`: Users see commands in their tenants + NULL `tenant_id`
- `entities`: Users see entities in their tenants + NULL `tenant_id`
- `tenant_members`: Users see their own memberships + all members if owner/admin

**Important**: RLS is bypassed for superusers and table owners. The `memory` database role must NOT be a superuser for RLS to take effect.

To set the current user context in queries (done automatically by the API):

```sql
SET LOCAL app.current_user_id = '550e8400-e29b-41d4-a716-446655440000';
```

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `pgUrl` | — | PostgreSQL connection string (required) |
| `redisUrl` | — | Redis connection string (required) |
| `ollamaUrl` | `http://localhost:11434` | Ollama embedding endpoint |
| `embeddingModel` | `nomic-embed-text` | Must produce 768-dim vectors |
| `agentId` | `main` | Namespace for this agent's writes |
| `bootstrapTtlSeconds` | `300` | How long to cache cold-start context |
| `MEMORY_JWT_SECRET` | — | JWT signing secret (enables multi-tenant auth) |
