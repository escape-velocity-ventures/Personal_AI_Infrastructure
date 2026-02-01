# pai-gastown-bridge

Conditional loading of PAI features based on Gas Town role detection.

## Overview

When PAI hooks run inside a Gas Town session, they should adapt their behavior based on the active role:

- **Crew** (human workspace): Full PAI experience
- **Polecats** (ephemeral workers): Minimal overhead, security only
- **System agents** (mayor, witness, refinery, deacon): Security + observability

This pack provides a simple API for PAI hooks to check whether they should execute.

## Installation

The pack is part of PAI and located at:
```
~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/
```

## Usage

### In PAI Hooks

Add this check at the top of your hook:

```typescript
import { shouldRun } from '~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src';

async function main() {
  const result = shouldRun({ feature: 'identity' });
  if (!result.shouldRun) {
    console.error(`[PAI] Skipping: ${result.reason}`);
    process.exit(0);
  }

  // ... rest of hook logic
}
```

### CLI Tool

```bash
# Show current Gas Town context
bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src/cli.ts detect

# Check if a feature should run
bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src/cli.ts check identity

# Show matrix for current role
bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src/cli.ts matrix

# Show full matrix for all roles
bun run ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src/cli.ts matrix --all
```

## API Reference

### `shouldRun(options)`

Check if a PAI feature should execute.

```typescript
interface ShouldRunOptions {
  feature: PAIFeature;
  forceEnable?: boolean;
  forceDisable?: boolean;
}

interface ShouldRunResult {
  shouldRun: boolean;
  reason: string;
  context: GasTownContext;
}
```

### `detectGasTown(cwd?)`

Detect Gas Town context from the current working directory.

```typescript
interface GasTownContext {
  isGasTown: boolean;
  role: GasTownRole | null;
  rig: string | null;
  member: string | null;
  rigRoot: string | null;
  gasTownRoot: string | null;
}
```

### `getContext()`

Get the cached Gas Town context (avoids repeated path parsing).

### `isMinimalMode(result)`

Check if the feature should run in "minimal" mode.

## Features

| Feature | Description | Hook |
|---------|-------------|------|
| `identity` | CORE identity injection | `load-core-context.ts` |
| `voice` | Voice notifications | `voice-reminder.ts`, `stop-hook-voice.ts` |
| `memory-sync` | Cloud memory sync | `sync-memory-*.ts` |
| `security` | Security validation | `security-validator.ts` |
| `infra-routing` | Infrastructure routing | `infra-routing-advisor.ts` |
| `observability` | Event capture | `capture-all-events.ts` |
| `telos` | TELOS briefing | `telos-briefing.ts` |
| `session` | Session management | `initialize-session.ts`, `session-capture.ts` |
| `tab-titles` | Terminal tab updates | `update-tab-titles.ts` |

## Default Matrix

| Role | identity | voice | memory | security | observability |
|------|----------|-------|--------|----------|---------------|
| **crew** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **polecats** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **witness** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **refinery** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **mayor** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **deacon** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **daemon** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **default** | ✓ | ✓ | ✓ | ✓ | ✓ |

## Environment Variables

Override the matrix with environment variables:

```bash
# Force enable specific features regardless of role
export PAI_GT_FORCE_ENABLE="voice,telos"

# Force disable specific features
export PAI_GT_FORCE_DISABLE="memory-sync"
```

These take precedence over role-based defaults.

## Priority Order

The `shouldRun()` function checks in this order (first match wins):

1. `forceDisable` option
2. `PAI_GT_FORCE_DISABLE` environment variable
3. `forceEnable` option
4. `PAI_GT_FORCE_ENABLE` environment variable
5. `PAI_SKIP_*` flags (e.g., `PAI_SKIP_MEMORY_SYNC=1`)
6. `PAI_HEADLESS=1` (disables most features)
7. Subagent mode (`CLAUDE_CODE_AGENT` or `SUBAGENT=true`)
8. Gas Town role matrix
9. Default: allow

## Testing

```bash
cd ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge
bun test
```

## Integrating Existing Hooks

To update an existing PAI hook:

```typescript
// Before (existing pattern)
function isSubagentSession(): boolean {
  return process.env.CLAUDE_CODE_AGENT !== undefined ||
         process.env.SUBAGENT === 'true';
}

if (isSubagentSession()) {
  process.exit(0);
}

// After (with gastown-bridge)
import { shouldRun } from 'pai-gastown-bridge';

const result = shouldRun({ feature: 'identity' }); // or appropriate feature
if (!result.shouldRun) {
  console.error(`[PAI] Skipping: ${result.reason}`);
  process.exit(0);
}
```

The `shouldRun()` function already includes subagent detection, so you can replace the manual check entirely.
