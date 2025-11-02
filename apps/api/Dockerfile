# syntax=docker/dockerfile:1.7

# Libpostal runtime (libs + CLI binaries + data)
FROM ghcr.io/guillemso1er/libpostal-runtime:1.1-2025-10-19 AS libpostal

############################
# 1) Build Node app with pnpm
############################
FROM node:22-bookworm-slim AS builder

# Toolchain needed to build native modules like argon2 (if no prebuild available)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# pnpm
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Copy manifests first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/

# Pre-fetch only API (and its workspace deps)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --filter @orbitcheck/api...

# Copy sources
COPY . .

# Install only what API needs from the store, offline
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter @orbitcheck/api... --offline --frozen-lockfile

# Build API and its deps (contracts, etc.)
RUN pnpm --filter @orbitcheck/api... build

# Create prod bundle for the API at /app
RUN pnpm --filter @orbitcheck/api deploy --prod /app

# Rebuild argon2 in the deployed app (node-postal is no longer used)
WORKDIR /app
ENV NPM_CONFIG_IGNORE_SCRIPTS=false \
    npm_config_unsafe_perm=true
RUN npm_config_build_from_source=true npm rebuild argon2 --verbose || true

# Optional sanity check (non-fatal)
RUN bash -lc 'ls -l node_modules/.pnpm/argon2@*/node_modules/argon2/build/Release/*.node || true'


############################
# 2) Runtime image
############################
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
ENV LIBPOSTAL_DATA_DIR=/opt/libpostal/data


# Minimal runtime tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Libpostal runtime (includes CLI binaries address_parser / expand_address)
COPY --from=libpostal /usr/local/ /usr/local/
COPY --from=libpostal /opt/libpostal/data /opt/libpostal/data
RUN ldconfig

WORKDIR /app
COPY --from=builder /app /app

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]