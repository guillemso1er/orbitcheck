# syntax=docker/dockerfile:1.7

############################
# 1) Build & install libpostal
############################
FROM debian:bookworm-slim AS libpostal-builder

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/libpostal

# Install build toolchain and deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    build-essential \
    autoconf \
    automake \
    libtool \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Build libpostal from source (pin to a tag/commit for reproducible builds)
ARG LIBPOSTAL_REF=v1.1
RUN git clone --depth 1 --branch ${LIBPOSTAL_REF} https://github.com/openvenues/libpostal.git . \
    && ./bootstrap.sh \
    && ./configure --datadir=/opt/libpostal/data \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# Download trained models and install the CLI for convenience
RUN /opt/libpostal/src/libpostal_data download all /opt/libpostal/data \
    && cp /opt/libpostal/src/.libs/address_parser /usr/local/bin/


############################
# 2) Build Node app with pnpm (monorepo-aware)
############################
FROM node:20-bookworm-slim AS builder

WORKDIR /workspace

# Enable pnpm via corepack and pin version to match package.json
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Prime install cache with workspace metadata and package manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Add any internal workspace packages your app depends on
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

# Install all deps (including dev) according to lockfile
RUN pnpm install --frozen-lockfile

# Copy sources to build
COPY apps apps
COPY packages packages
# If you have a root tsconfig/base config, copy it as well
# COPY tsconfig.json ./

# Build all packages that define a build script (ensures contracts is built before api)
RUN pnpm -r build

# Create a prod-only bundle for the API (includes node_modules) to /app
RUN pnpm deploy --filter @orbitcheck/api --prod /app


############################
# 3) Minimal runtime image
############################
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
# Ensure libpostal knows where the models are
ENV LIBPOSTAL_DATA_DIR=/opt/libpostal/data

# Tiny init for proper signal handling + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Bring libpostal runtime bits
COPY --from=libpostal-builder /usr/local/ /usr/local/
COPY --from=libpostal-builder /opt/libpostal/data /opt/libpostal/data
RUN ldconfig

# App files from pnpm deploy
WORKDIR /app
COPY --from=builder /app /app

# Drop privileges
RUN chown -R node:node /app
USER node

EXPOSE 8080

# Optional health check (adjust path if your service differs)
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]