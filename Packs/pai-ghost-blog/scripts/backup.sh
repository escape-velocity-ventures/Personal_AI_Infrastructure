#!/bin/bash
set -e

BACKUP_DIR="${1:-./ghost-backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="$BACKUP_DIR/ghost-backup-$TIMESTAMP"

echo "=== Backing up Ghost Blog ==="

# Create backup directory
mkdir -p "$BACKUP_PATH"

# Get pod name
POD=$(kubectl get pods -n pai-blog -l app.kubernetes.io/name=ghost -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POD" ]; then
  echo "ERROR: Ghost pod not found"
  exit 1
fi

echo "Found Ghost pod: $POD"

# Backup content directory
echo "Backing up content..."
kubectl cp "pai-blog/$POD:/var/lib/ghost/content" "$BACKUP_PATH/content"

# Create tarball
echo "Creating archive..."
tar -czf "$BACKUP_PATH.tar.gz" -C "$BACKUP_DIR" "ghost-backup-$TIMESTAMP"
rm -rf "$BACKUP_PATH"

echo ""
echo "=== Backup Complete ==="
echo "Archive: $BACKUP_PATH.tar.gz"
echo "Size: $(du -h "$BACKUP_PATH.tar.gz" | cut -f1)"
