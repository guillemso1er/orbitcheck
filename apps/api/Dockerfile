# syntax=docker/dockerfile:1.7

FROM ghcr.io/guillemso1er/libpostal-runtime:1.1-2025-10-19 AS libpostal

############################
# 1) Build Node app with pnpm
############################
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY --from=libpostal /usr/local/ /usr/local/
RUN ldconfig

RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Copy all package.json files first
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY apps/dashboard/package.json apps/dashboard/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY apps apps
COPY packages packages

# Build contracts first explicitly, then everything else
RUN pnpm --filter @orbitcheck/contracts build && \
    pnpm --filter @orbitcheck/dashboard build && \
    pnpm --filter @orbitcheck/api build

# Create prod bundle
RUN pnpm deploy --filter @orbitcheck/api --prod /app


############################
# 2) Runtime image
############################
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
ENV LIBPOSTAL_DATA_DIR=/opt/libpostal/data

# Runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Libpostal runtime (libs + models); no CLI needed for node-postal
COPY --from=libpostal /usr/local/ /usr/local/
COPY --from=libpostal /opt/libpostal/data /opt/libpostal/data
RUN ldconfig

# App files
WORKDIR /app
COPY --from=builder /app /app

# Drop privileges
RUN chown -R node:node /app
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]