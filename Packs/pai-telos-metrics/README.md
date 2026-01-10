# pai-telos-metrics

Automated metrics tracking and KPI logging for TELOS goals.

## Overview

TELOS Metrics transforms your TELOS framework from a static document into a living accountability system. Define KPIs linked to your goals, track daily progress, and receive alignment briefings at each session start.

**Philosophy:** "Your manager is data." - Digital Self Management

## Features

- **TELOS Integration** - Parses your existing TELOS.md to understand goals
- **KPI Tracking** - Define and log key performance indicators
- **Daily Briefings** - Automatic progress reports at session start
- **Streak Tracking** - Build consistency with streak milestones
- **Goal Alignment** - Link every metric to a TELOS goal

## Quick Start

```bash
# View daily briefing
bun run src/tools/DailyBriefing.ts

# Log a metric
bun run src/tools/MetricsLogger.ts log --kpi pai_commits --value 5

# Check progress
bun run src/tools/MetricsLogger.ts status

# Parse TELOS structure
bun run src/tools/TelosParser.ts
```

## Structure

```
pai-telos-metrics/
├── SKILL.md              # Skill definition for Claude
├── INSTALL.md            # Installation instructions
├── README.md             # This file
├── src/
│   └── tools/
│       ├── TelosParser.ts    # Parse TELOS.md
│       ├── MetricsLogger.ts  # Log and query KPIs
│       └── DailyBriefing.ts  # Generate briefings
├── data/
│   ├── kpi-config.yaml   # KPI definitions
│   └── metrics.jsonl     # Stored measurements
└── hooks/
    └── telos-briefing.ts # SessionStart hook
```

## Default KPIs

The pack includes sample KPIs linked to common TELOS goals:

| KPI | Goal | Target |
|-----|------|--------|
| pai_commits | G2: Enable software creation | 5/day |
| deep_work_hours | G2 | 4 hours/day |
| content_published | G1: Teach what's possible | 1/week |
| exercise_minutes | G3: Make time for exercise | 30 min/day |
| social_activities | G4: Cultivate relationships | 2/week |

Customize `data/kpi-config.yaml` to match your goals.

## Daily Briefing Format

```
## Daily Alignment Briefing - 2026-01-10

### Active Goals
- **G1:** Teach people what is possible with current and future technology
- **G2:** Enable anyone to create custom software

### KPI Progress
| KPI | Today | Target | 7-Day Avg | Streak | Status |
|-----|-------|--------|-----------|--------|--------|
| PAI Commits | 7 | 5 | 4.3 | 5d | On Track |
| Deep Work Hours | 3 | 4 | 3.2 | 2d | Below |

### Focus Suggestions
- **Deep Work Hours** is at 3/4. Consider blocking focused time.
```

## CLI Commands

### MetricsLogger

```bash
# Log a value
bun run src/tools/MetricsLogger.ts log --kpi <id> --value <n> [--note "..."]

# Today's entries
bun run src/tools/MetricsLogger.ts today

# Summary with trends
bun run src/tools/MetricsLogger.ts summary [--days 7]

# Current status
bun run src/tools/MetricsLogger.ts status

# Check streak
bun run src/tools/MetricsLogger.ts streak <kpi_id>

# List KPIs
bun run src/tools/MetricsLogger.ts list
```

### TelosParser

```bash
# Summary view
bun run src/tools/TelosParser.ts

# JSON output
bun run src/tools/TelosParser.ts --json

# Specific section
bun run src/tools/TelosParser.ts --section=goals
```

### DailyBriefing

```bash
# Full briefing
bun run src/tools/DailyBriefing.ts

# Compact (for hooks)
bun run src/tools/DailyBriefing.ts --compact

# JSON format
bun run src/tools/DailyBriefing.ts --json
```

## Configuration

### kpi-config.yaml

```yaml
kpis:
  - id: commits_per_day
    name: Daily Commits
    description: Git commits made
    goal_ref: G2          # Links to TELOS Goal
    type: counter         # counter, duration, boolean, rating
    target: 5
    frequency: daily      # daily or weekly
    unit: commits

streaks:
  enabled: true
  milestones: [3, 7, 14, 30]
```

### KPI Types

- **counter** - Discrete events (commits, tasks)
- **duration** - Time tracked (hours, minutes)
- **boolean** - Yes/no daily tracking
- **rating** - 1-10 subjective scale

## Installation

See [INSTALL.md](./INSTALL.md) for detailed setup instructions.

## Related

- **TELOS.md** - Your life operating system (`$PAI_DIR/skills/CORE/USER/TELOS.md`)
- **pai-observability-server** - Real-time event streaming (future dashboard integration)

## License

Part of Personal AI Infrastructure (PAI).
