# PAI Apple Ecosystem Pack

Integrates Apple Calendar, Reminders, Contacts, and Notes with Claude Code via AppleScript automation.

## Requirements

- macOS only (uses AppleScript)
- Grant Terminal/Bun automation permissions in System Settings > Privacy & Security > Automation

## Installation

```bash
bash manage.sh install  # Install dependencies
bash manage.sh link     # Link to ~/.claude/Packs
```

## Available Tools

### Calendar
- `apple_calendar_list` - List all calendars
- `apple_calendar_today` - Get today's events
- `apple_calendar_week` - Get this week's events
- `apple_calendar_events` - Get events in a date range
- `apple_calendar_search` - Search events by title/location
- `apple_calendar_create` - Create a new event

### Reminders
- `apple_reminders_lists` - List all reminder lists
- `apple_reminders_all` - Get all reminders
- `apple_reminders_today` - Get reminders due today
- `apple_reminders_overdue` - Get overdue reminders
- `apple_reminders_search` - Search reminders
- `apple_reminders_create` - Create a new reminder
- `apple_reminders_complete` - Mark a reminder complete

### Contacts
- `apple_contacts_groups` - List contact groups
- `apple_contacts_search` - Search contacts
- `apple_contacts_get` - Get a specific contact
- `apple_contacts_group` - Get contacts in a group

### Notes
- `apple_notes_folders` - List note folders
- `apple_notes_list` - List notes
- `apple_notes_get` - Get a specific note
- `apple_notes_search` - Search notes
- `apple_notes_create` - Create a new note

## CLI Testing

```bash
bun run src/calendar/index.ts calendars
bun run src/calendar/index.ts today
bun run src/calendar/index.ts week

bun run src/reminders/index.ts lists
bun run src/reminders/index.ts all
bun run src/reminders/index.ts today

bun run src/contacts/index.ts groups
bun run src/contacts/index.ts search "john"

bun run src/notes/index.ts folders
bun run src/notes/index.ts search "meeting"
```

## MCP Server

Start the MCP server (for Claude Code integration):

```bash
bash manage.sh mcp
# or
bun run src/mcp-server.ts
```

## HTTP Server

The HTTP server exposes Apple tools and health data ingestion for network access:

```bash
bun run src/http-server.ts
# Runs on port 8081 by default
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/tools` | List available tools |
| POST | `/call` | Call an Apple tool |
| POST | `/health/ingest` | Receive Apple Health data |
| GET | `/health/ingest/status` | Health ingestion status |

## Apple Health Integration

Automatically sync health data using the [Health Auto Export](https://www.healthyapps.dev/health-auto-export) iOS app ($24.99 lifetime).

### Setup Instructions

1. **Install Health Auto Export** from the App Store
2. **Enable Premium** (required for REST API export)
3. **Configure Automations**:
   - Open Health Auto Export → Automations
   - Tap + to add new automation
   - Select metrics: Step Count, Apple Exercise Time, Sleep Analysis
   - Set schedule: Daily (e.g., 8:00 AM)
   - Export type: REST API
   - URL: `http://<your-mac-ip>:8081/health/ingest`
   - Method: POST
   - Headers: `Content-Type: application/json`

4. **Start the HTTP server** on your Mac:
   ```bash
   cd Packs/pai-apple-ecosystem
   bun run src/http-server.ts
   ```

5. **Verify** data is syncing:
   ```bash
   curl http://localhost:8081/health/ingest/status
   ```

### Supported Metrics

| Health Auto Export Metric | TELOS KPI | Goal |
|---------------------------|-----------|------|
| Step Count | `steps_count` | G3 |
| Apple Exercise Time | `exercise_minutes` | G3 |
| Sleep Analysis | `sleep_hours` | - |

### Manual Test

```bash
curl -X POST http://localhost:8081/health/ingest \
  -H "Content-Type: application/json" \
  -d '{"data":{"metrics":[{"name":"Step Count","units":"steps","data":[{"qty":8000,"date":"2026-01-13"}]}]}}'
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `8081` |
| `TELOS_METRICS_PATH` | Path to metrics.jsonl | Auto-detected |

## Production Deployment (Mac Mini)

For persistent deployment on a Mac Mini (e.g., Plato), use the launchd service.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mac Mini (Plato)                             │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │     Lima VM (k3s cluster)                                 │ │
│  │     K8s Services: apple-mcp:8081                          │ │
│  └───────────────────────│───────────────────────────────────┘ │
│                          │ (192.168.5.2)                       │
│                          ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  launchd: com.pai.apple-ecosystem                         │ │
│  │  → bun run src/http-server.ts                             │ │
│  │  → Port 8081                                              │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

iPhone (Health Auto Export)
    ↓ POST to http://plato.local:8081/health/ingest
```

### Install launchd Service

```bash
# Copy plist to LaunchAgents
cp launchd/com.pai.apple-ecosystem.plist ~/Library/LaunchAgents/

# Load and start service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pai.apple-ecosystem.plist

# Verify
curl http://localhost:8081/health
```

### Manage Service

```bash
# Check status
launchctl print gui/$(id -u)/com.pai.apple-ecosystem

# Restart
launchctl kickstart -k gui/$(id -u)/com.pai.apple-ecosystem

# Stop
launchctl bootout gui/$(id -u)/com.pai.apple-ecosystem

# View logs
tail -f ~/Library/Logs/pai-apple-ecosystem.log
tail -f ~/Library/Logs/pai-apple-ecosystem.error.log
```

### K8s Integration (Lima k3s)

When running alongside a Lima k3s cluster, the service is exposed via K8s:

```bash
# Apply K8s manifests (from TinkerBelle-config)
HOST_IP=192.168.5.2  # Lima host gateway
kubectl apply -f deployments/pai-k8s/native-apple-service.yaml

# Test from cluster
kubectl run test --rm -it --image=curlimages/curl -- curl http://apple-mcp:8081/health
```

See [TinkerBelle-config/deployments/pai-k8s](https://github.com/escape-velocity-ventures/TinkerBelle-config/tree/main/deployments/pai-k8s) for full setup.
