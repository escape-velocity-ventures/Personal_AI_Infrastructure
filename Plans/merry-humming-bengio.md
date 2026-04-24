# Migrate from pai-state-service to pai-memory

## Context

The current memory system uses `pai-state-service` (Redis) to sync the local `~/.claude/MEMORY/` directory between machines via file-level mtime comparison. The new `pai-memory` service (pgvector + Redis) provides semantic search, entity graphs, command logging, and bootstrap context — a fundamentally richer model. The service is already deployed at `memory-api.escape-velocity-ventures.org` and the env vars (`MEMORY_API_URL`, `MEMORY_API_KEY`) are already in `settings.json`. We just need to wire the hooks.

## Files

### Create

| File | Purpose |
|------|---------|
| `~/.claude/hooks/lib/memory-api.ts` | HTTP client for pai-memory API |
| `~/.claude/hooks/bootstrap-from-memory.ts` | SessionStart: inject `/bootstrap` chunks as `<system-reminder>` |
| `~/.claude/hooks/remember-learnings.ts` | Stop: walk modified MEMORY/ files, `POST /remember` each |

### Modify

| File | Change |
|------|--------|
| `~/.claude/hooks/capture-all-events.ts` | Add `POST /commands` call for tool-use logging |
| `~/.claude/hooks/initialize-session.ts` | Remove `spawnBackgroundSessionSync()` (spawns deleted sync script) |
| `~/.claude/settings.json` | Swap hook refs, remove `PAI_STATE_SERVICE_URL` + `PAI_STATE_API_KEY` from env |

### Deprecate (rename to `.deprecated`)

| File | Reason |
|------|--------|
| `~/.claude/hooks/sync-memory-from-cloud.ts` | Replaced by `bootstrap-from-memory.ts` |
| `~/.claude/hooks/sync-memory-to-cloud.ts` | Replaced by `remember-learnings.ts` |
| `~/.claude/hooks/sync-sessions-background.ts` | No longer needed |
| `~/.claude/hooks/lib/state-service.ts` | Replaced by `memory-api.ts` |
| `~/.claude/hooks/lib/conflict-resolver.ts` | No file-level CAS in new model |

---

## Implementation

### Step 1: Create `hooks/lib/memory-api.ts`

Thin HTTP client wrapping the pai-memory REST API. Follow the same pattern as the old `state-service.ts`: constructor with baseUrl/apiKey, private `getHeaders()`, try/catch on every method, `AbortSignal.timeout(3000)`.

Methods needed:
- `isAvailable()` — `GET /health`
- `bootstrap(agentId)` — `GET /bootstrap?agent={id}`, returns `{ chunks, count, cacheHit }`
- `remember(content, opts)` — `POST /remember`, returns chunk ID
- `logCommand(entry)` — `POST /commands`, fire-and-forget safe
- `search(query, opts)` — `POST /search`, returns results array

Reference: `~/EscapeVelocity/PersonalAI/PAI/Packs/pai-memory/src/server.ts` for endpoint contracts.

### Step 2: Create `hooks/bootstrap-from-memory.ts`

SessionStart hook. Replaces `sync-memory-from-cloud.ts`.

1. Gate via `shouldRunSafe({ feature: 'memory-sync' })`
2. Call `client.bootstrap('aurelia')`
3. Format returned chunks as a single `<system-reminder>` block on stdout (same pattern as `load-core-context.ts`)
4. Each chunk gets a header: `### {memoryType} [{tags}]`

### Step 3: Create `hooks/remember-learnings.ts`

Stop hook. Replaces `sync-memory-to-cloud.ts`.

1. Gate via `shouldRunSafe({ feature: 'memory-sync' })`
2. Read `.current-session` for session start time + session ID
3. Walk `MEMORY/` dirs for files modified since session start (reuse the walker from old hook)
4. Derive metadata from path:
   - `Learning/`, `learnings/` → episodic, tags: [learning], long-term
   - `WORK/` → episodic, tags: [work], standard
   - `RESEARCH/` → semantic, tags: [research], long-term
   - `Infra/` → semantic, tags: [infrastructure], long-term
   - `designs/` → semantic, tags: [design], long-term
   - `sessions/`, `SESSIONS/` → episodic, tags: [session], standard
   - `State/` → procedural, tags: [state], standard
   - `Signals/` → episodic, tags: [signal], standard
   - `identities/` → semantic, tags: [identity], long-term
   - `organizations/` → semantic, tags: [organization], long-term
5. Chunk files >500 words at heading/paragraph boundaries
6. `POST /remember` for each chunk with `sourcePath` set for traceability

No CAS needed — chunks are immutable writes (new UUID each time).

### Step 4: Add command logging to `capture-all-events.ts`

After the existing JSONL write, before `process.exit(0)`:

1. Import `MemoryApiClient` from `./lib/memory-api`
2. Extract `toolName` and `commandText` from hook data (Bash → command, file tools → file_path)
3. `await client.logCommand({ toolName, commandText, sessionId, agentId, outcome, ts })`
4. 3-second timeout, catch all errors silently

### Step 5: Update `settings.json`

**hooks.SessionStart**: Replace `sync-memory-from-cloud.ts` → `bootstrap-from-memory.ts`
**hooks.Stop**: Replace `sync-memory-to-cloud.ts` → `remember-learnings.ts`
**env**: Remove `PAI_STATE_SERVICE_URL` and `PAI_STATE_API_KEY`

### Step 6: Clean up `initialize-session.ts`

Remove `spawnBackgroundSessionSync()` function and its call at line 216.

### Step 7: Deprecate old files

Rename the 5 old files with `.deprecated` suffix. Delete after 2 weeks of stable operation.

---

## Verification

**Pre-activation (steps 1-4 done, step 5 not yet):**
```bash
# Test bootstrap hook manually
echo '{"session_id":"test"}' | bun run ~/.claude/hooks/bootstrap-from-memory.ts
# Should output <system-reminder> block to stdout

# Test remember hook manually
echo '{}' | bun run ~/.claude/hooks/remember-learnings.ts
# Should report remembered/skipped counts to stderr

# Check service health
curl -s https://memory-api.escape-velocity-ventures.org/health \
  -H "Authorization: Bearer $MEMORY_API_KEY"
```

**Post-activation (step 5 done):**
1. Start a new Claude Code session
2. Ask "what bootstrap context was loaded?" — should see semantic memory chunks
3. Work for a few interactions, stop session
4. Verify learnings stored: `curl -X POST .../search -d '{"query":"recent","limit":5}'`
5. Verify commands logged: `curl .../stats` — check commands count increased

**Rollback:** Revert `settings.json` hooks + re-add env vars. Restore `.deprecated` files.
