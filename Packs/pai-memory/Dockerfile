# Stage 1: Build UI
FROM oven/bun:1.2-alpine AS ui-builder

WORKDIR /app/ui
COPY ui/package.json ui/bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY ui/ .
RUN bun run build

# Stage 2: Build API
FROM oven/bun:1.2-alpine AS api-builder

WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src/ ./src/

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.2-alpine

WORKDIR /app

COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/src ./src
COPY --from=ui-builder /app/ui/dist ./ui/dist
COPY package.json ./

EXPOSE 3000

ENV PORT=3000

CMD ["bun", "run", "src/server.ts"]
