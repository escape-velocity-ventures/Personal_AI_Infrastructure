# PAI Ghost Blog

Self-hosted Ghost CMS for the PAI blog series.

## Architecture

```
Ghost (SQLite) → Cloudflared → Cloudflare Edge → Internet
                     ↑
              (outbound only)
```

- **Ghost 5.x** with SQLite database (no external DB required)
- **Cloudflare Tunnel** for secure external access (no open ports)
- **Longhorn** storage for redundancy across K8s nodes

## Local Development

```bash
# Start Ghost locally with Podman/Docker
podman run -d --name ghost-local \
  -p 2368:2368 \
  -e url=http://localhost:2368 \
  -e database__client=sqlite3 \
  -v ~/ghost-local-content:/var/lib/ghost/content \
  ghost:5-alpine

# Access
# Blog: http://localhost:2368
# Admin: http://localhost:2368/ghost
```

## Posting Content

```bash
# Post markdown to Ghost (auto-loads API key from PAI/.env)
bun run src/post-to-ghost.ts \
  --file ~/.claude/MEMORY/blog-post.md \
  --image ~/Downloads/header.png \
  --title "Post Title" \
  --publish  # optional
```

## K8s Deployment

### Prerequisites

1. **Cloudflare Tunnel** - Create in Zero Trust dashboard
2. **DNS** - CNAME `blog` → `<tunnel-id>.cfargotunnel.com`
3. **Storage Class** - Longhorn or similar

### Deploy

```bash
# Create tunnel secret
kubectl create secret generic cloudflare-tunnel \
  --namespace pai-blog \
  --from-literal=token=YOUR_TUNNEL_TOKEN

# Deploy
./scripts/deploy.sh
```

### Backup

```bash
./scripts/backup.sh ~/backups
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GHOST_URL` | Ghost instance URL | `http://localhost:2368` |
| `GHOST_ADMIN_KEY` | Admin API key | (required) |

## Files

```
pai-ghost-blog/
├── k8s/
│   ├── namespace.yaml
│   ├── ghost-pvc.yaml
│   ├── ghost-deployment.yaml
│   ├── ghost-service.yaml
│   ├── cloudflared-deployment.yaml
│   └── secrets.yaml.template
├── scripts/
│   ├── deploy.sh
│   └── backup.sh
├── src/
│   └── post-to-ghost.ts
└── README.md
```

## URLs

- **Production:** https://blog.escape-velocity-ventures.org
- **Local:** http://localhost:2368
