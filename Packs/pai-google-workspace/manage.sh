#!/bin/bash
# PAI Google Workspace - Management Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAI_DIR="${PAI_DIR:-$HOME/.config/pai}"

# Load environment
if [ -f "$PAI_DIR/.env" ]; then
  export $(grep -v '^#' "$PAI_DIR/.env" | xargs)
fi

case "$1" in
  auth)
    echo "Starting Google OAuth flow..."
    cd "$SCRIPT_DIR" && bun run src/cli/auth.ts "${@:2}"
    ;;

  status)
    echo "Checking authentication status..."
    cd "$SCRIPT_DIR" && bun run src/cli/auth.ts status
    ;;

  gmail)
    cd "$SCRIPT_DIR" && bun run src/cli/gmail.ts "${@:2}"
    ;;

  calendar)
    cd "$SCRIPT_DIR" && bun run src/cli/calendar.ts "${@:2}"
    ;;

  drive)
    cd "$SCRIPT_DIR" && bun run src/cli/drive.ts "${@:2}"
    ;;

  mcp)
    echo "Starting MCP server..."
    cd "$SCRIPT_DIR" && bun run src/mcp/server.ts
    ;;

  install)
    echo "Installing dependencies..."
    cd "$SCRIPT_DIR" && bun install
    echo "Done. Run: ./manage.sh auth login"
    ;;

  *)
    echo "PAI Google Workspace Management"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  auth login      Authenticate with Google"
    echo "  auth status     Check authentication status"
    echo "  auth logout     Remove stored tokens"
    echo ""
    echo "  gmail           Gmail CLI (search, read, send, labels)"
    echo "  calendar        Calendar CLI (list, get, create, freebusy)"
    echo "  drive           Drive CLI (list, search, get, read)"
    echo ""
    echo "  mcp             Start MCP server (for Claude Code)"
    echo "  install         Install dependencies"
    ;;
esac
