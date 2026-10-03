---
name: pai-google-workspace
version: 1.0.0
dependencies: [pai-core-install]
---

# PAI Google Workspace Integration

Full Gmail, Calendar, and Drive integration for PAI via MCP server.

## Features

- **Gmail**: Search, read, and send emails
- **Calendar**: List events, create meetings, check availability
- **Drive**: Browse files, search, read content

## Architecture

```
MCP Server (stdio) ←→ Claude Code
      ↓
  Google APIs (OAuth 2.0)
      ↓
Gmail / Calendar / Drive
```

## Quick Start

```bash
# 1. Put your Google Cloud OAuth client's ID and secret in ~/.env, as the
#    GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET variables (see "Where settings
#    are found" below for other accepted files).

# 2. Authenticate
bun run auth login

# 3. Test
bun run gmail search "is:unread"
```

### Where settings are found

`src/lib/config.ts` resolves settings the same way however the process was started (terminal, Claude Code, MCP server):

- **OAuth client:** a non-empty value in the process environment wins. Otherwise the first **non-empty** value from these files, in order: `$PAI_GOOGLE_ENV_FILE`, `~/.env`, `$PAI_DIR/.env`, `~/.config/pai/.env`, `~/.claude/.env`. An empty value in one file never hides a real value in another.
- **Token file:** `$PAI_GOOGLE_TOKEN_FILE` if set. Otherwise the first that exists of `$PAI_DIR/.google-tokens.json`, `~/.claude/.google-tokens.json`, `~/.config/pai/.google-tokens.json`. For a first login, it's created under `$PAI_DIR` (or `~/.config/pai`).

Values are never printed. If the client is missing, the error lists the files that were checked.

## MCP Tools

| Tool | Description |
|------|-------------|
| `gmail_search` | Search messages |
| `gmail_read` | Read message content |
| `gmail_send` | Send email |
| `calendar_list` | List upcoming events |
| `calendar_create` | Create event |
| `calendar_freebusy` | Check availability |
| `drive_list` | List files |
| `drive_search` | Search files |
| `drive_read` | Read file content |

## OAuth Scopes

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/drive.readonly`
