#!/bin/bash
# PAI Apple Ecosystem Pack Management Script

PACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_NAME="pai-apple-ecosystem"

case "$1" in
    install)
        echo "Installing $PACK_NAME dependencies..."
        cd "$PACK_DIR" && bun install
        echo "Done. Pack installed."
        ;;

    test)
        echo "Testing Apple Ecosystem integration..."
        echo ""
        echo "=== Calendar Test ==="
        cd "$PACK_DIR" && bun run src/calendar/index.ts calendars 2>/dev/null || echo "Calendar: Permission needed or no calendars"
        echo ""
        echo "=== Reminders Test ==="
        cd "$PACK_DIR" && bun run src/reminders/index.ts lists 2>/dev/null || echo "Reminders: Permission needed or no lists"
        echo ""
        echo "=== Contacts Test ==="
        cd "$PACK_DIR" && bun run src/contacts/index.ts groups 2>/dev/null || echo "Contacts: Permission needed or no groups"
        echo ""
        echo "=== Notes Test ==="
        cd "$PACK_DIR" && bun run src/notes/index.ts folders 2>/dev/null || echo "Notes: Permission needed or no folders"
        echo ""
        echo "Testing complete. Grant permissions in System Settings > Privacy & Security if needed."
        ;;

    mcp)
        echo "Starting MCP server..."
        cd "$PACK_DIR" && bun run src/mcp-server.ts
        ;;

    link)
        echo "Linking pack to ~/.claude/Packs..."
        mkdir -p ~/.claude/Packs
        ln -sf "$PACK_DIR" ~/.claude/Packs/$PACK_NAME
        echo "Linked: ~/.claude/Packs/$PACK_NAME -> $PACK_DIR"
        ;;

    unlink)
        echo "Unlinking pack from ~/.claude/Packs..."
        rm -f ~/.claude/Packs/$PACK_NAME
        echo "Unlinked."
        ;;

    *)
        echo "Usage: $0 {install|test|mcp|link|unlink}"
        echo ""
        echo "Commands:"
        echo "  install  - Install bun dependencies"
        echo "  test     - Test all Apple integrations"
        echo "  mcp      - Start MCP server (stdio)"
        echo "  link     - Symlink to ~/.claude/Packs"
        echo "  unlink   - Remove symlink"
        exit 1
        ;;
esac
