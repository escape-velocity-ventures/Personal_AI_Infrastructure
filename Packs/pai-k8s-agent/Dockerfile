# PAI K8s Agent Dockerfile
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY ../pai-llm-provider ../pai-llm-provider

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Production image
FROM oven/bun:1.3-slim

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Set environment
ENV NODE_ENV=production
ENV PORT=8080
ENV LLM_ENDPOINT=http://vllm-service:8000/v1
ENV APPLE_MCP_URL=http://apple-mcp:8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD curl -f http://localhost:8080/health || exit 1

# Expose port
EXPOSE 8080

# Run
CMD ["bun", "run", "src/server.ts"]
