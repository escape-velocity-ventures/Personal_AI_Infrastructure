# PAI Google Workspace - Installation Guide

## Prerequisites

- Bun runtime installed
- Google Cloud project with OAuth 2.0 credentials
- PAI Core installed (`$PAI_DIR` set)

## Phase 1: System Analysis

Check prerequisites:
```bash
# Verify Bun is installed
bun --version

# Verify PAI_DIR is set
echo $PAI_DIR

# Check if port 9876 is available (OAuth callback)
lsof -i :9876
```

## Phase 2: Google Cloud Setup

If you don't have OAuth credentials yet:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API
4. Create OAuth 2.0 credentials:
   - Application type: Desktop app
   - Download credentials JSON
5. Configure OAuth consent screen:
   - User type: Internal (for Workspace) or External
   - Add scopes for Gmail, Calendar, Drive

## Phase 3: Installation

```bash
# Navigate to pack directory
cd /Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-google-workspace

# Install dependencies
bun install

# Add credentials to .env
echo "GOOGLE_CLIENT_ID=your-client-id" >> $PAI_DIR/.env
echo "GOOGLE_CLIENT_SECRET=your-client-secret" >> $PAI_DIR/.env
```

## Phase 4: Authentication

```bash
# Run OAuth flow
./manage.sh auth login

# This will:
# 1. Open browser to Google consent screen
# 2. Start local server on port 9876 for callback
# 3. Save tokens to $PAI_DIR/.google-tokens.json
```

## Phase 5: MCP Registration

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "pai-google-workspace": {
      "command": "bun",
      "args": ["run", "/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-google-workspace/src/mcp/server.ts"],
      "env": {
        "PAI_DIR": "/Users/benjamin/.config/pai"
      }
    }
  }
}
```

Restart Claude Code to load the MCP server.

## Verification

Run verification checklist:
```bash
# Check auth status
./manage.sh auth status

# Test Gmail
./manage.sh gmail labels

# Test Calendar
./manage.sh calendar list

# Test Drive
./manage.sh drive list
```

See VERIFY.md for complete verification checklist.
