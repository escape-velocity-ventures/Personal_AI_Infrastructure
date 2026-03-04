FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY src/ ./src/

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.2-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY package.json ./

EXPOSE 3000

ENV PORT=3000

CMD ["bun", "run", "src/server.ts"]
