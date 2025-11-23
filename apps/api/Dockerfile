# syntax=docker/dockerfile:1.7

# 1) Build Node app
# We can use Node 22 safely now!
FROM node:22-bookworm-slim AS builder

# Install build tools (only needed if argon2 or other native deps require compilation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Copy manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/contracts/openapi packages/contracts/openapi

# Install dependencies
# Note: Make sure you run `pnpm remove node-postal` in your project first!
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter @orbitcheck/api... --frozen-lockfile

# Build
COPY . .
RUN pnpm --filter @orbitcheck/api... build

# Deploy production bundle to /app
RUN pnpm --filter @orbitcheck/api deploy --prod /app

# --- REBUILD NATIVE MODULES ---
WORKDIR /app
# We only need to worry about standard native modules like argon2 now.
# No node-postal steps here.
RUN npm rebuild argon2 --build-from-source


# 2) Runtime Image
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
# No LIBPOSTAL_DATA_DIR needed anymore

# Minimal runtime tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built app
COPY --from=builder /app /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]