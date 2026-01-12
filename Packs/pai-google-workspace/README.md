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
# 1. Add credentials to .env
echo "GOOGLE_CLIENT_ID=your-client-id" >> $PAI_DIR/.env
echo "GOOGLE_CLIENT_SECRET=your-client-secret" >> $PAI_DIR/.env

# 2. Authenticate
bun run auth login

# 3. Test
bun run gmail search "is:unread"
```

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
