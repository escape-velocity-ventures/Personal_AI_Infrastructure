# PAI Google Workspace - Verification Checklist

## Authentication

- [ ] OAuth credentials configured in `$PAI_DIR/.env`
  ```bash
  grep GOOGLE_CLIENT_ID $PAI_DIR/.env
  ```

- [ ] Token file exists with valid tokens
  ```bash
  ls -la $PAI_DIR/.google-tokens.json
  ```

- [ ] Auth status shows valid
  ```bash
  ./manage.sh auth status
  ```

## Gmail

- [ ] Can list labels
  ```bash
  ./manage.sh gmail labels
  ```

- [ ] Can search messages
  ```bash
  ./manage.sh gmail search "is:inbox" 5
  ```

## Calendar

- [ ] Can list events
  ```bash
  ./manage.sh calendar list --days 7
  ```

## Drive

- [ ] Can list files
  ```bash
  ./manage.sh drive list --max 5
  ```

## MCP Server

- [ ] MCP server starts without errors
  ```bash
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun run src/mcp/server.ts
  ```

- [ ] MCP server registered in Claude Code settings
  ```bash
  grep pai-google-workspace ~/.claude/settings.json
  ```

## All Checks Passed

Once all items are checked, the installation is complete. You can now use Google Workspace tools in Claude Code:

- `gmail_search` - Search emails
- `gmail_read` - Read email content
- `gmail_send` - Send emails
- `calendar_list` - List events
- `calendar_create` - Create events
- `drive_list` - Browse files
- `drive_search` - Search files
- `drive_read` - Read file content
