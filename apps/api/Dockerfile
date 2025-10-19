# syntax=docker/dockerfile:1.7

# Pull in prebuilt libpostal (libs + models)
# Replace with your image/tag built once in CI
FROM ghcr.io/guillemso1er/libpostal-runtime:1.1-2025-10-19 AS libpostal

############################
# 1) Build Node app with pnpm
############################
FROM node:20-bookworm-slim AS builder

# Build deps for native modules (node-postal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Bring in libpostal headers/libs so node-postal can compile
COPY --from=libpostal /usr/local/ /usr/local/
RUN ldconfig

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json

# Install all deps (node-postal will compile here)
RUN pnpm install --frozen-lockfile

# Copy sources and build
COPY apps apps
COPY packages packages
RUN pnpm -r build

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