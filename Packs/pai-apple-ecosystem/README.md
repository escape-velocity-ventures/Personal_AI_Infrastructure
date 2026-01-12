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
