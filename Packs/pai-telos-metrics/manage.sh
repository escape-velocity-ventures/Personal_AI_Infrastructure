#!/bin/bash
# manage.sh - TELOS Metrics Dashboard management script
#
# Usage:
#   ./manage.sh start    - Start server and client
#   ./manage.sh stop     - Stop all services
#   ./manage.sh server   - Start only the server
#   ./manage.sh client   - Start only the client (dev mode)
#   ./manage.sh status   - Check service status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/src/dashboard/server"
CLIENT_DIR="$SCRIPT_DIR/src/dashboard/client"
PID_FILE="/tmp/telos-metrics-server.pid"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

start_server() {
    echo -e "${GREEN}Starting TELOS Metrics Server...${NC}"

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "${YELLOW}Server already running (PID: $PID)${NC}"
            return
        fi
    fi

    cd "$SERVER_DIR"
    bun run index.ts > /tmp/telos-metrics-server.log 2>&1 &
    echo $! > "$PID_FILE"

    sleep 1
    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "${GREEN}Server started (PID: $(cat "$PID_FILE"))${NC}"
        echo -e "  API: http://localhost:4100/api/dashboard"
        echo -e "  WebSocket: ws://localhost:4100/stream"
    else
        echo -e "${RED}Server failed to start. Check /tmp/telos-metrics-server.log${NC}"
    fi
}

stop_server() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "${YELLOW}Stopping server (PID: $PID)...${NC}"
            kill "$PID"
            rm "$PID_FILE"
            echo -e "${GREEN}Server stopped${NC}"
        else
            echo "Server not running"
            rm "$PID_FILE"
        fi
    else
        echo "No PID file found"
    fi
}

start_client() {
    echo -e "${GREEN}Starting TELOS Metrics Client (dev mode)...${NC}"
    cd "$CLIENT_DIR"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        bun install
    fi

    echo -e "  Dashboard: http://localhost:5173"
    bun run dev
}

check_status() {
    echo -e "${GREEN}TELOS Metrics Dashboard Status${NC}"
    echo ""

    # Server status
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "Server: ${GREEN}Running${NC} (PID: $PID)"

            # Check health endpoint
            if curl -s http://localhost:4100/health > /dev/null 2>&1; then
                echo -e "  Health: ${GREEN}OK${NC}"
            else
                echo -e "  Health: ${YELLOW}Not responding${NC}"
            fi
        else
            echo -e "Server: ${RED}Not running${NC} (stale PID file)"
        fi
    else
        echo -e "Server: ${RED}Not running${NC}"
    fi

    echo ""

    # Client status (check if vite dev server is running)
    if lsof -i :5173 > /dev/null 2>&1; then
        echo -e "Client: ${GREEN}Running${NC} on http://localhost:5173"
    else
        echo -e "Client: ${YELLOW}Not running${NC}"
    fi
}

case "${1:-status}" in
    start)
        start_server
        echo ""
        echo -e "${YELLOW}Run './manage.sh client' in another terminal for the dashboard${NC}"
        ;;
    stop)
        stop_server
        ;;
    server)
        start_server
        ;;
    client)
        start_client
        ;;
    status)
        check_status
        ;;
    restart)
        stop_server
        sleep 1
        start_server
        ;;
    *)
        echo "TELOS Metrics Dashboard"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  start   - Start the server (background)"
        echo "  stop    - Stop the server"
        echo "  server  - Start server (foreground)"
        echo "  client  - Start client dev server"
        echo "  status  - Show service status"
        echo "  restart - Restart the server"
        exit 1
        ;;
esac
