---
name: TelosMetrics
description: Automated metrics tracking and KPI logging for TELOS goals. USE WHEN daily briefing, log metrics, track KPIs, goal progress, alignment check, or "how am I doing".
---

# TELOS Metrics - Goal Alignment & KPI Tracking

**PURPOSE:** Operationalize the TELOS framework with automated metrics tracking, KPI logging, daily alignment briefings, and progress visualization. "Your manager is data."

**PHILOSOPHY:** Goals without measurement are wishes. TELOS Metrics connects your Problems -> Mission -> Goals to concrete, trackable KPIs that show daily progress toward your ideal state.

## Quick Start

```bash
# Daily briefing (shows goal alignment + yesterday's metrics)
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/DailyBriefing.ts

# Log a KPI value
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts log --kpi commits_per_day --value 7

# View current progress
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts status

# Parse TELOS.md structure
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/TelosParser.ts
```

## How It Works

### 1. TELOS Integration
Reads your existing `$PAI_DIR/skills/CORE/USER/TELOS.md` to understand:
- **Problems (P[n])** - What you're solving
- **Mission (M[n])** - Your purpose
- **Goals (G[n])** - What success looks like
- **Projects** - Current work streams

### 2. KPI Configuration
Define KPIs in `data/kpi-config.yaml` that link to your TELOS goals:

```yaml
kpis:
  - id: commits_per_day
    name: Daily Commits
    goal_ref: G2      # Links to TELOS Goal G2
    target: 5
    unit: count

  - id: deep_work_hours
    name: Deep Work Hours
    goal_ref: G1
    target: 4
    unit: hours
```

### 3. Metrics Storage
KPI measurements stored in `data/metrics.jsonl`:
```json
{"timestamp":"2026-01-10T10:30:00Z","kpi_id":"commits_per_day","value":7,"goal_ref":"G2"}
```

### 4. Daily Briefing
Generated at session start, includes:
- Active goals from TELOS
- KPI progress vs targets (7-day trend)
- Streak tracking
- Suggested focus areas

## Workflow Triggers

| Trigger | Action |
|---------|--------|
| Session start | Auto-display daily briefing (via hook) |
| "daily briefing" | Generate alignment report |
| "log metric" / "log kpi" | Record a KPI value |
| "track [kpi]" | Log specific KPI |
| "how am I doing" | Show current progress |
| "goal status" | TELOS goal alignment check |

## Tools

| Tool | Purpose |
|------|---------|
| `TelosParser.ts` | Parse TELOS.md into structured data |
| `MetricsLogger.ts` | Log KPIs, view status, calculate trends |
| `DailyBriefing.ts` | Generate daily alignment report |

## Data Files

| File | Purpose |
|------|---------|
| `data/kpi-config.yaml` | KPI definitions linked to TELOS goals |
| `data/metrics.jsonl` | Time-series KPI measurements |

## Integration

### Uses
- **CORE Skill** - Reads TELOS.md from USER directory
- **Voice System** - Announces daily briefing (optional)

### Hook Integration
The `hooks/telos-briefing.ts` SessionStart hook:
- Runs on each new Claude session
- Generates daily briefing
- Returns context for CORE to display

## Daily Briefing Format

```markdown
## Daily Alignment Briefing - 2026-01-10

### Active Goals
- **G1:** Teach people what is possible with current and future technology
- **G2:** Enable anyone to create custom software

### KPI Progress

| KPI | Yesterday | Target | 7-Day Avg | Status |
|-----|-----------|--------|-----------|--------|
| Daily Commits | 7 | 5 | 4.3 | On Track |
| Deep Work Hours | 3 | 4 | 3.2 | Below Target |

### Streaks
- Daily Commits: 5 days
- Deep Work: 2 days

### Focus Suggestion
Deep Work Hours is trending below target. Consider blocking 2 hours
of focused time today.
```

## KPI Types

### Counter KPIs
Discrete events counted daily:
- `commits_per_day` - Git commits
- `tasks_completed` - Todos marked done
- `sessions_started` - Claude sessions

### Duration KPIs
Time tracked in hours:
- `deep_work_hours` - Focused work time
- `exercise_minutes` - Physical activity

### Boolean KPIs
Daily yes/no tracking:
- `morning_routine` - Did routine?
- `journal_entry` - Wrote entry?

## Manual Logging

```bash
# Log a numeric value
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts log \
  --kpi commits_per_day \
  --value 7

# Log with note
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts log \
  --kpi deep_work_hours \
  --value 4.5 \
  --note "Focused PAI development session"

# View today's entries
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts today

# View 7-day summary
bun run $PAI_DIR/Packs/pai-telos-metrics/src/tools/MetricsLogger.ts summary
```

## Future Phases

### Phase 2: Dashboard
Real-time web dashboard showing:
- Goal cards with progress bars
- KPI trend charts
- Daily alignment score

### Phase 3: Automatic Collectors
- Git activity (commits, PRs)
- Claude session metrics
- Calendar integration

## The Purpose

**Transform TELOS from a document into a living system.**

Your goals are clear. Your KPIs are defined. Now track them daily,
see your progress, and let data be your manager.

**This is not documentation. This is your daily accountability system.**
