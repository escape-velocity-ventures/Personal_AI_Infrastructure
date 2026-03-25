# Engram Integrations

Integration modules for embedding Engram memory into external systems.

## NanoClaw Bootstrap Hook

Inject relevant memories into NanoClaw container-isolated agent sessions at startup.

### Overview

When a NanoClaw agent starts, it can query Engram for semantically relevant memories based on:
- The conversation topic
- The first user message
- Task-specific context

These memories are formatted as structured text blocks and injected into the LLM's system prompt.

### Usage

```typescript
import { bootstrapFromEngram } from 'pai-memory/integrations/nanoclaw-bootstrap';

// At NanoClaw session initialization
const memoryContext = await bootstrapFromEngram({
  engramUrl: 'http://memory-api.memory.svc:3000',
  token: process.env.ENGRAM_JWT_TOKEN,
  namespace: 'production',
  query: 'kubernetes deployment strategies',
  limit: 10,
  minSimilarity: 0.6,
  tags: ['kubernetes', 'production'],
});

if (memoryContext.available && memoryContext.count > 0) {
  // Inject into system prompt
  const systemPrompt = `
${baseSystemPrompt}

---

${memoryContext.context}
`;
}
```

### API Reference

#### `bootstrapFromEngram(options)`

Fetch relevant memories via semantic search.

**Parameters:**
- `engramUrl` (string): Engram API base URL
- `token` (string): JWT authentication token
- `namespace` (string): Namespace/tenant identifier
- `query` (string): Semantic search query
- `limit` (number, optional): Max memories to retrieve (default: 10)
- `minSimilarity` (number, optional): Similarity threshold 0-1 (default: 0.5)
- `memoryType` (string, optional): Filter by type (semantic|episodic|procedural)
- `tags` (string[], optional): Filter by tags

**Returns:** `BootstrapResult`
```typescript
{
  context: string;      // Formatted memory blocks
  count: number;        // Number of memories retrieved
  available: boolean;   // Whether Engram was reachable
  error?: string;       // Error message if failed
}
```

#### `fetchBootstrapContext(engramUrl, token)`

Fetch curated bootstrap memories (alternative to semantic search).

Use this when you don't have a specific query yet and want the standard
curated context (memories tagged `curated` or `memory-md`).

**Parameters:**
- `engramUrl` (string): Engram API base URL
- `token` (string): JWT authentication token

**Returns:** `BootstrapResult`

### Output Format

Memory context is formatted as structured Markdown:

```markdown
# Relevant Memories (3)

The following memories were retrieved from namespace "production" based on semantic similarity to your current task.

## Memory 1 [kubernetes, deployment]
**Source:** `k8s/deployment-patterns.md`
**Type:** semantic
**Created:** 2026-03-20
**Similarity:** 0.87

Kubernetes deployments use rolling updates by default. Configure with maxSurge and maxUnavailable.

---

## Memory 2 [kubernetes, networking]
**Source:** `k8s/network-policies.md`
**Type:** semantic
**Created:** 2026-03-21
**Similarity:** 0.72

NetworkPolicies block all ingress by default. Use label selectors for pod targeting.

---

## Memory 3 [production, incident-response]
...
```

### Graceful Degradation

The bootstrap hook handles failures gracefully:

- **Engram unreachable:** Returns empty context, logs warning, session continues
- **No matching memories:** Returns empty context (valid state)
- **Network timeout:** 5 second limit, returns empty context
- **API error:** Returns empty context with error in result

**Never crashes the NanoClaw session.** Memories are an enhancement, not a requirement.

### Authentication

Expects JWT token with:
- `sub`: User ID
- `tenantIds`: Array of tenant UUIDs the user has access to

Engram enforces row-level security based on these tenant IDs.

### Performance

- **Request timeout:** 5 seconds
- **Typical latency:** 200-500ms (depends on corpus size and embedding model)
- **Caching:** Engram caches embeddings in Redis (24h TTL)
- **Bootstrap cache:** Curated memories cached in Redis (5 min TTL)

### NanoClaw Integration Pattern

```typescript
// nanoclaw-init.ts
import { bootstrapFromEngram } from 'pai-memory/integrations/nanoclaw-bootstrap';

async function initializeAgent(sessionConfig) {
  const { userId, firstMessage, namespace } = sessionConfig;

  // Option 1: Semantic search based on first message
  const memories = await bootstrapFromEngram({
    engramUrl: process.env.ENGRAM_URL,
    token: generateJWT(userId),
    namespace,
    query: firstMessage,
    limit: 15,
  });

  // Option 2: Curated bootstrap context (no query needed)
  const bootstrap = await fetchBootstrapContext(
    process.env.ENGRAM_URL,
    generateJWT(userId)
  );

  // Inject into container environment
  return {
    systemPrompt: buildPrompt(memories.context),
    memoryCount: memories.count,
    memoryAvailable: memories.available,
  };
}
```

### Testing

```bash
cd /Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-memory
bun test src/integrations/nanoclaw-bootstrap.test.ts
```

All tests include:
- Successful memory retrieval
- Empty results handling
- Engram unavailability
- API error handling
- Timeout enforcement
- Context formatting validation

### Future Enhancements

- **Real-time memory updates:** Subscribe to memory:new events via WebSocket
- **Multi-query bootstrap:** Combine topic-based + entity-based + command-based searches
- **Smart limit tuning:** Adjust limit based on LLM context window

---

## NanoClaw Session Write-Back

Automatically summarize and persist agent session transcripts to Engram (completing the memory loop).

### Overview

When a NanoClaw agent session ends, write back a summary so future sessions can pick up where things left off.

### Usage

```typescript
import { writeBackSession } from 'pai-memory/integrations/nanoclaw';

// At the end of a NanoClaw agent session:
await writeBackSession({
  engramUrl: 'http://localhost:3001',
  token: 'jwt-token',
  namespace: 'personal',  // or 'org:acme' for multi-tenant
  sessionId: 'session-abc-123',
  channel: 'slack:engineering',
  participants: ['alice', 'bob'],
  messages: [
    { role: 'user', content: 'How do I deploy?', timestamp: '2026-03-25T10:00:00Z' },
    { role: 'assistant', content: 'Use the deploy script...', timestamp: '2026-03-25T10:00:15Z' },
  ],

  // Optional: custom summarizer (defaults to LLM-based summarization)
  summarizer: async (messages) => {
    // Extract key decisions, facts, action items
    return 'Custom summary...';
  },
});
```

### Configuration

```bash
# Optional: LLM endpoint for summarization (if not set, uses raw transcript)
export SUMMARIZER_LLM_URL=http://localhost:11434/v1/completions

# Engram connection (required)
export ENGRAM_PG_URL=postgresql://localhost:5432/engram
export ENGRAM_REDIS_URL=redis://localhost:6379
```

### How It Works

1. Takes a conversation transcript (array of messages)
2. Summarizes using:
   - Custom summarizer function (if provided)
   - LLM endpoint (if `SUMMARIZER_LLM_URL` is set)
   - Raw transcript fallback (if no LLM configured)
3. Writes to Engram with metadata:
   - Tags: `session_summary`, `channel:slack:engineering`
   - Source: `nanoclaw:session-id:participants:alice,bob`
   - Type: `episodic` memory
   - Tenant: namespace (for multi-tenant isolation)

### Fire-and-Forget Pattern

Session write-back is designed as fire-and-forget:
- Logs errors but doesn't throw
- Session ending shouldn't block on memory persistence
- Failed writes are logged for debugging but don't crash the session

### Testing

```bash
cd /Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-memory
bun test src/integrations/nanoclaw-writeback.test.ts
```

All tests include:
- Metadata tagging
- Custom vs default summarizer
- Error handling
- Transcript formatting
- Multi-tenant isolation
