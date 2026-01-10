# Installing pai-telos-metrics

## Prerequisites

- Bun runtime installed
- PAI infrastructure with CORE skill
- TELOS.md in `$PAI_DIR/skills/CORE/USER/TELOS.md`

## Installation Steps

### 1. Copy Pack to PAI Directory

```bash
# If installing from Packs directory
cp -r Packs/pai-telos-metrics $PAI_DIR/Packs/

# Or symlink for development
ln -s "$(pwd)/Packs/pai-telos-metrics" "$PAI_DIR/Packs/pai-telos-metrics"
```

### 2. Add SessionStart Hook

Add the following to your `~/.claude/settings.json` in the `hooks.SessionStart` array:

```json
{
  "type": "command",
  "command": "bun run $PAI_DIR/Packs/pai-telos-metrics/hooks/telos-briefing.ts"
}
```

**Example full SessionStart section:**

```json
"SessionStart": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "bun run $PAI_DIR/hooks/initialize-session.ts"
      },
      {
        "type": "command",
        "command": "bun run $PAI_DIR/hooks/load-core-context.ts"
      },
      {
        "type": "command",
        "command": "bun run $PAI_DIR/Packs/pai-telos-metrics/hooks/telos-briefing.ts"
      }
    ]
  }
]
```

### 3. Verify Installation

```bash
# Test TELOS parser
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/TelosParser.ts

# Test daily briefing
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/DailyBriefing.ts

# List available KPIs
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts list
```

### 4. Log Your First Metric

```bash
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts log \
  --kpi pai_commits \
  --value 3 \
  --note "First metrics log"
```

### 5. Customize KPIs (Optional)

Edit `$PAI_DIR/Packs/pai-telos-metrics/data/kpi-config.yaml` to customize KPIs for your goals.

## Verification

Start a new Claude session - you should see the TELOS briefing in the session output.

```bash
# Or manually run the hook
echo '{"session_id": "test"}' | bun run $PAI_DIR/Packs/pai-telos-metrics/hooks/telos-briefing.ts
```

## Troubleshooting

**Hook not running:**
- Ensure `$PAI_DIR` environment variable is set in settings.json
- Check hook path is correct
- Verify Bun is installed: `bun --version`

**Parser errors:**
- Ensure TELOS.md exists at correct path
- Check TELOS.md follows the expected format (P1:, M1:, G1: patterns)

**Metrics not saving:**
- Check write permissions on data directory
- Verify kpi-config.yaml is valid YAML
