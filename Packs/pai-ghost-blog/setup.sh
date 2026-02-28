#!/usr/bin/env bash
# Setup script for pai-ghost-blog
# Pulls Ghost and Cloudflare Access credentials from k8s cluster and writes .env
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - Secrets exist in 'infrastructure' namespace:
#     - ghost-admin-api (key: key)
#     - cloudflare-ghost-access-token (keys: client-id, client-secret)
#
# Usage:
#   ./setup.sh                    # Auto-detect k8s server
#   ./setup.sh --server <url>     # Specify k8s API server

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PAI_DIR/.env"
NAMESPACE="infrastructure"

# Parse args
K8S_SERVER=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --server) K8S_SERVER="--server=$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "🔑 Pulling Ghost blog credentials from cluster..."

# Ghost Admin API key
GHOST_ADMIN_KEY=$(kubectl $K8S_SERVER get secret ghost-admin-api -n "$NAMESPACE" \
  -o jsonpath='{.data.key}' | base64 -d)
if [[ -z "$GHOST_ADMIN_KEY" ]]; then
  echo "❌ Failed to get ghost-admin-api secret"
  exit 1
fi
echo "   ✅ Ghost Admin API key"

# Ghost URL
GHOST_URL=$(kubectl $K8S_SERVER get secret ghost-admin-api -n "$NAMESPACE" \
  -o jsonpath='{.data.url}' 2>/dev/null | base64 -d 2>/dev/null || true)
if [[ -z "$GHOST_URL" ]]; then
  # Fall back to common default
  GHOST_URL="https://blog.escape-velocity-ventures.org"
  echo "   ⚠️  Ghost URL not in secret, using default: $GHOST_URL"
else
  echo "   ✅ Ghost URL"
fi

# Cloudflare Access service token
CF_ACCESS_CLIENT_ID=$(kubectl $K8S_SERVER get secret cloudflare-ghost-access-token -n "$NAMESPACE" \
  -o jsonpath='{.data.client-id}' | base64 -d)
CF_ACCESS_CLIENT_SECRET=$(kubectl $K8S_SERVER get secret cloudflare-ghost-access-token -n "$NAMESPACE" \
  -o jsonpath='{.data.client-secret}' | base64 -d)
if [[ -z "$CF_ACCESS_CLIENT_ID" || -z "$CF_ACCESS_CLIENT_SECRET" ]]; then
  echo "❌ Failed to get cloudflare-ghost-access-token secret"
  exit 1
fi
echo "   ✅ Cloudflare Access service token"

# Write or update .env
# Preserve existing vars that aren't ours
GHOST_VARS="GHOST_URL GHOST_ADMIN_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET"
if [[ -f "$ENV_FILE" ]]; then
  # Remove our vars from existing file
  TEMP=$(mktemp)
  grep -v -E "^(GHOST_URL|GHOST_ADMIN_KEY|CF_ACCESS_CLIENT_ID|CF_ACCESS_CLIENT_SECRET)=" "$ENV_FILE" > "$TEMP" || true
  mv "$TEMP" "$ENV_FILE"
fi

# Append our vars
cat >> "$ENV_FILE" << EOF
GHOST_URL=$GHOST_URL
GHOST_ADMIN_KEY=$GHOST_ADMIN_KEY
CF_ACCESS_CLIENT_ID=$CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET=$CF_ACCESS_CLIENT_SECRET
EOF

echo ""
echo "✅ Credentials written to $ENV_FILE"
echo "   You can now run: bun run src/post-to-ghost.ts --file <markdown>"
