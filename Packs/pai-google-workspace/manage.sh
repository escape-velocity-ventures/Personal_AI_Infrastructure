#!/bin/bash
# PAI Google Workspace - Management Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Credentials and the token file are resolved by src/lib/config.ts, the same way
# however the session was launched (terminal vs Claude Code). The old
# `export $(... | xargs)` loader broke on values with spaces and let EMPTY
# values in $PAI_DIR/.env override real ones (pai-config-81cn), so it was removed.

# Deprecated in favour of TinkerBelle's tb-google (TinkerBelle-12uu.5). The notice
# goes to stderr so stdout, which callers parse, is unchanged. `mcp` is exempt: it
# has no replacement yet (TinkerBelle-12uu.4).
if [ "$1" != "mcp" ]; then
  echo "DEPRECATED: pai-google-workspace is replaced by TinkerBelle's tb-google. Run: tb-google ${1:-<service>} ... (same flags). See README.md." >&2
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
    echo "  drive docs      Docs CLI (read, get, append, update, replace)"
    echo ""
    echo "  mcp             Start MCP server (for Claude Code)"
    echo "  install         Install dependencies"
    ;;
esac
