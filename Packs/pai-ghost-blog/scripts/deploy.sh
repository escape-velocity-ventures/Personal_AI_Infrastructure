#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/../k8s"

echo "=== Deploying PAI Ghost Blog ==="

# Create namespace
echo "Creating namespace..."
kubectl apply -f "$K8S_DIR/namespace.yaml"

# Check for tunnel secret
if ! kubectl get secret cloudflare-tunnel -n pai-blog &>/dev/null; then
  echo ""
  echo "ERROR: Cloudflare tunnel secret not found!"
  echo ""
  echo "Create it with:"
  echo "  kubectl create secret generic cloudflare-tunnel \\"
  echo "    --namespace pai-blog \\"
  echo "    --from-literal=token=YOUR_TUNNEL_TOKEN"
  echo ""
  echo "Get your token from: Cloudflare Zero Trust > Access > Tunnels"
  exit 1
fi

# Deploy storage
echo "Creating PVC..."
kubectl apply -f "$K8S_DIR/ghost-pvc.yaml"

# Deploy Ghost
echo "Deploying Ghost..."
kubectl apply -f "$K8S_DIR/ghost-deployment.yaml"
kubectl apply -f "$K8S_DIR/ghost-service.yaml"

# Deploy Cloudflared tunnel
echo "Deploying Cloudflare tunnel..."
kubectl apply -f "$K8S_DIR/cloudflared-deployment.yaml"

# Wait for rollout
echo "Waiting for Ghost to be ready..."
kubectl rollout status deployment/ghost -n pai-blog --timeout=120s

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Ghost is running in namespace: pai-blog"
echo "URL: https://blog.escape-velocity-ventures.org"
echo ""
echo "To check status:"
echo "  kubectl get pods -n pai-blog"
echo ""
echo "To view logs:"
echo "  kubectl logs -n pai-blog -l app.kubernetes.io/name=ghost"
