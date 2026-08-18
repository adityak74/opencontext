# ============================================================
# open-context — single image: UI + API server + MCP server
# Docker Hub: https://hub.docker.com/r/adityakarnam/open-context
# ============================================================

# Stage 1: Build the React UI
FROM node:25-slim AS ui-builder

WORKDIR /ui

COPY ui/package.json ui/package-lock.json* ./
RUN npm ci

COPY ui/ ./
RUN npm run build


# Stage 2: Build the TypeScript server / CLI / MCP
FROM node:25-slim AS server-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


# Stage 3: Production image
FROM node:25-slim

WORKDIR /app

# Database drivers to bake in (BYODB). Empty by default, which keeps the image
# small — opencontext runs on the built-in JSON, memory, SQLite and Cloudflare D1
# backends with no driver at all.
#
#   docker build --build-arg DB_DRIVERS="pg" -t opencontext .
#   docker build --build-arg DB_DRIVERS="mongodb redis" -t opencontext .
ARG DB_DRIVERS=""

# Install production dependencies only. Optional peer dependencies are not
# auto-installed by npm, so only the drivers named above are added.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev \
 && if [ -n "$DB_DRIVERS" ]; then npm install --no-save $DB_DRIVERS; fi

# Copy compiled server + MCP + CLI
COPY --from=server-builder /app/dist ./dist

# Copy built UI into /app/public so the server can serve it
COPY --from=ui-builder /ui/dist ./public

# Persistent volume for MCP context store
RUN mkdir -p /root/.opencontext
VOLUME /root/.opencontext

# Environment defaults
ENV OPENCONTEXT_STORE_PATH=/root/.opencontext/contexts.json
# Ollama on the host machine — accessible from inside Docker via host.docker.internal
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV PORT=3000

EXPOSE 3000

# Default: run the HTTP server (serves UI + REST API)
# Override for MCP stdio mode:
#   docker run -i adityakarnam/open-context:latest node dist/mcp/index.js
CMD ["node", "dist/server.js"]
