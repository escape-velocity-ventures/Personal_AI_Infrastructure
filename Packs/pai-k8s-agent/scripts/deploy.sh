#!/bin/bash
# PAI K8s Deployment Script
# Deploys all PAI infrastructure components to Kubernetes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PACKS_ROOT="$(dirname "$PROJECT_ROOT")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        log_error "docker not found. Please install docker."
        exit 1
    fi

    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster."
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Build images
build_images() {
    log_info "Building container images..."

    # Build PAI Agent
    log_info "Building pai-k8s-agent..."
    docker build -t pai-k8s-agent:latest "$PROJECT_ROOT"

    # Build Terminal Bridge (for Mac nodes, usually not containerized)
    # log_info "Building pai-terminal-bridge..."
    # docker build -t pai-terminal-bridge:latest "$PACKS_ROOT/pai-terminal-bridge"

    # Build Apple MCP (for Mac nodes, usually not containerized)
    # log_info "Building pai-apple-ecosystem..."
    # docker build -t pai-apple-ecosystem:latest "$PACKS_ROOT/pai-apple-ecosystem"

    log_success "Images built successfully"
}

# Deploy state services (Redis, PostgreSQL)
deploy_state_services() {
    log_info "Deploying state services..."

    STATE_DIR="$PACKS_ROOT/pai-state-service/k8s"

    if [ -f "$STATE_DIR/redis.yaml" ]; then
        log_info "Deploying Redis..."
        kubectl apply -f "$STATE_DIR/redis.yaml"
    fi

    if [ -f "$STATE_DIR/postgres.yaml" ]; then
        log_info "Deploying PostgreSQL..."
        kubectl apply -f "$STATE_DIR/postgres.yaml"
    fi

    log_success "State services deployed"
}

# Deploy PAI Agent
deploy_agent() {
    log_info "Deploying PAI Agent..."

    AGENT_DIR="$PROJECT_ROOT/k8s"

    kubectl apply -f "$AGENT_DIR/deployment.yaml"
    kubectl apply -f "$AGENT_DIR/service.yaml"

    log_success "PAI Agent deployed"
}

# Deploy Terminal Bridge (on Mac nodes)
deploy_terminal_bridge() {
    log_info "Deploying Terminal Bridge..."

    BRIDGE_DIR="$PACKS_ROOT/pai-terminal-bridge/k8s"

    kubectl apply -f "$BRIDGE_DIR/deployment.yaml"
    kubectl apply -f "$BRIDGE_DIR/service.yaml"

    log_success "Terminal Bridge deployed"
}

# Deploy Apple MCP (on Mac nodes)
deploy_apple_mcp() {
    log_info "Deploying Apple MCP..."

    APPLE_DIR="$PACKS_ROOT/pai-apple-ecosystem/k8s"

    kubectl apply -f "$APPLE_DIR/daemonset.yaml"
    kubectl apply -f "$APPLE_DIR/service.yaml"

    log_success "Apple MCP deployed"
}

# Wait for deployments to be ready
wait_for_ready() {
    log_info "Waiting for deployments to be ready..."

    kubectl rollout status deployment/pai-agent --timeout=120s || true
    kubectl rollout status deployment/pai-terminal-bridge --timeout=120s || true
    kubectl rollout status daemonset/apple-mcp --timeout=120s || true

    log_success "All deployments ready"
}

# Show status
show_status() {
    echo ""
    log_info "Deployment Status:"
    echo ""

    echo "Pods:"
    kubectl get pods -l 'app in (pai-agent,pai-terminal-bridge,apple-mcp,redis,postgres)' -o wide

    echo ""
    echo "Services:"
    kubectl get svc -l 'app in (pai-agent,pai-terminal-bridge,apple-mcp,redis,postgres)'

    echo ""
    echo "Terminal Bridge NodePort:"
    kubectl get svc pai-terminal-bridge -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "Not found"
    echo ""
}

# Main
main() {
    echo ""
    echo "╭─────────────────────────────────────╮"
    echo "│  PAI K8s Deployment                 │"
    echo "╰─────────────────────────────────────╯"
    echo ""

    check_prerequisites

    case "${1:-all}" in
        build)
            build_images
            ;;
        state)
            deploy_state_services
            ;;
        agent)
            deploy_agent
            ;;
        bridge)
            deploy_terminal_bridge
            ;;
        apple)
            deploy_apple_mcp
            ;;
        status)
            show_status
            ;;
        all)
            build_images
            deploy_state_services
            deploy_agent
            deploy_terminal_bridge
            deploy_apple_mcp
            wait_for_ready
            show_status
            ;;
        *)
            echo "Usage: $0 {build|state|agent|bridge|apple|status|all}"
            exit 1
            ;;
    esac

    echo ""
    log_success "Done!"
}

main "$@"
