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

# Build libpostal from source
ARG LIBPOSTAL_REF=v1.1
RUN git clone --depth 1 --branch ${LIBPOSTAL_REF} https://github.com/openvenues/libpostal.git . \
    && ./bootstrap.sh \
    && ./configure --datadir=/opt/libpostal/data \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# Build address_parser and rename it to match your Node app's expectation
RUN cd /opt/libpostal/src \
    && make address_parser

# Download trained models and install the CLI with correct name
RUN /opt/libpostal/src/libpostal_data download all /opt/libpostal/data \
    && cp /opt/libpostal/src/.libs/address_parser /usr/local/bin/parse-address \
    && chmod +x /usr/local/bin/parse-address

############################
# 2) Build Node app with pnpm
############################
FROM node:20-bookworm-slim AS builder

# Install build deps for native modules (if using node-postal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Copy package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy sources and build
COPY apps apps
COPY packages packages
RUN pnpm -r build

# Create prod bundle
RUN pnpm deploy --filter @orbitcheck/api --prod /app

############################
# 3) Runtime image
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

# Copy libpostal runtime bits and the CLI
COPY --from=libpostal-builder /usr/local/ /usr/local/
COPY --from=libpostal-builder /opt/libpostal/data /opt/libpostal/data
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