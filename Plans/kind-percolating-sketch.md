# Plan: Move TB content-cli to PAI as `tier-cli`

## Context

Two CLIs named "content-cli" exist in different repos with completely different purposes:
- **TB `content-cli`** (`TinkerBelle/cli/content/`) — AI tier generation engine (free/starter/pro) + social media + content calendar. Created Feb 25, 2026. Not wired into the unified `tb` CLI. No other TinkerBelle module imports it.
- **PAI `content-cli`** (`PAI/Packs/pai-ghost-blog/src/content-cli.ts`) — Blog/postmortem lifecycle management. Created Jan 25, 2026. Actively used daily.

The TB content-cli belongs with the PAI blog tools since it's a content monetization/distribution tool, not infrastructure. Moving it resolves the name collision and puts it next to the Ghost API layer it duplicates.

## Steps

### 1. Copy source files to PAI pack

Copy `TinkerBelle/cli/content/src/` files into `PAI/Packs/pai-ghost-blog/src/`:

| Source | Destination | Notes |
|--------|-------------|-------|
| `index.ts` | `tier-cli.ts` | Rename entry point |
| `generator.ts` | `tier-generator.ts` | Prefix to avoid future collisions |
| `publisher.ts` | `tier-publisher.ts` | Prefix |
| `sync.ts` | `tier-sync.ts` | Prefix |
| `scheduler.ts` | `tier-scheduler.ts` | Prefix |
| `calendar.ts` | `tier-calendar.ts` | Prefix |
| `prompts.ts` | `tier-prompts.ts` | Prefix |
| `types.ts` | `tier-types.ts` | Prefix |
| `social/index.ts` | `social/index.ts` | Keep social/ subdir |
| `social/twitter.ts` | `social/twitter.ts` | Keep |
| `social/linkedin.ts` | `social/linkedin.ts` | Keep |
| `social/types.ts` | `social/types.ts` | Keep |

### 2. Update internal imports in tier-cli.ts

Change all `./generator.js` → `./tier-generator.js` etc. (6 import rewrites in the entry point, plus cross-references between modules).

### 3. Update pai-ghost-blog package.json

Add dependencies that the tier-cli needs but pai-ghost-blog doesn't have:

```json
{
  "@anthropic-ai/sdk": "^0.39.0",
  "commander": "^12.0.0",
  "js-yaml": "^4.1.0"
}
```

(`chalk` and `marked` are already present or used via bun's built-in resolution.)

### 4. Refactor Ghost API duplication

`tier-publisher.ts` duplicates JWT generation and CF Access header logic from `ghost-cli.ts`. Extract shared helpers:

- **Option A (minimal):** Leave as-is for now. The duplication is ~40 lines and works.
- **Option B (clean):** Create `ghost-helpers.ts` with `generateJWT()` and `getCloudflareAccessCreds()`, import from both `ghost-cli.ts` and `tier-publisher.ts`.

**Recommendation:** Option A. The duplication is small and the credential resolution paths differ slightly (ghost-cli has 1Password fallback, tier-publisher is k8s-only). Refactoring can happen later without risk.

### 5. Remove from TinkerBelle workspace

- Delete `TinkerBelle/cli/content/` directory
- Remove `"content"` from `TinkerBelle/cli/package.json` workspaces array
- No unified `tb` CLI changes needed (content was never wired in)

### 6. Run `bun install` in both repos

- `TinkerBelle/cli/` — relink workspace without content
- `PAI/Packs/pai-ghost-blog/` — install new dependencies

### 7. Update documentation

**MEMORY.md** — Add tier-cli reference under the content pipeline section:
```
- **tier-cli**: `bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/tier-cli.ts`
  - `tier-cli generate post.md` — AI-powered free/starter/pro tier generation
  - `tier-cli publish ./tiers/` — Publish tiers to Ghost with visibility gating
  - `tier-cli social publish twitter post.md` — Social media distribution
  - `tier-cli schedule run` — Content calendar execution
```

**CORE SKILL.md** — Add to tool routing table:
```
| Tier content generation | tier-cli | `bun run .../pai-ghost-blog/src/tier-cli.ts generate <file>` |
| Social media publishing | tier-cli | `bun run .../pai-ghost-blog/src/tier-cli.ts social publish <platform> <file>` |
```

## Files Modified

| File | Action |
|------|--------|
| `PAI/Packs/pai-ghost-blog/src/tier-cli.ts` | Create (from content/src/index.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-generator.ts` | Create (from generator.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-publisher.ts` | Create (from publisher.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-sync.ts` | Create (from sync.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-scheduler.ts` | Create (from scheduler.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-calendar.ts` | Create (from calendar.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-prompts.ts` | Create (from prompts.ts) |
| `PAI/Packs/pai-ghost-blog/src/tier-types.ts` | Create (from types.ts) |
| `PAI/Packs/pai-ghost-blog/src/social/` | Create dir (from social/) |
| `PAI/Packs/pai-ghost-blog/package.json` | Add 3 dependencies |
| `TinkerBelle/cli/content/` | Delete entire directory |
| `TinkerBelle/cli/package.json` | Remove "content" from workspaces |
| `~/.claude/projects/-Users-benjamin/memory/MEMORY.md` | Add tier-cli reference |

## Verification

1. `bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/tier-cli.ts --help` — should show generate/batch/publish/sync/schedule/social commands
2. `bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/content-cli.ts --help` — unchanged, still works
3. `bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-ghost-blog/src/ghost-cli.ts --help` — unchanged, still works
4. `cd ~/EscapeVelocity/TinkerBelle/cli && bun install` — workspace resolves without content
5. `bun run ~/EscapeVelocity/TinkerBelle/cli/tb/src/index.ts --help` — unified CLI still works
