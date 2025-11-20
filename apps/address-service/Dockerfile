FROM ghcr.io/guillemso1er/orbitcheck/libpostal-base:latest AS base

FROM node:20-bookworm-slim

# --- COPY ARTIFACTS ---
COPY --from=base /usr/local/include /usr/local/include
COPY --from=base /usr/local/lib /usr/local/lib
COPY --from=base /opt/libpostal/data /opt/libpostal/data

# --- CONFIGURATION ---
# FIX: Point directly to the 'libpostal' subdir where 'transliteration' lives
ENV LIBPOSTAL_DATA_DIR=/opt/libpostal/data/libpostal
ENV LD_LIBRARY_PATH=/usr/local/lib
ENV PORT=3000
ENV npm_config_build_from_source=true

# --- INSTALL BUILD TOOLS ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN ldconfig

COPY package.json .

# --- INSTALL & BUILD ---
RUN npm install fastify
RUN npm install node-postal --ignore-scripts

WORKDIR /app/node_modules/node-postal
RUN npm install --verbose

# --- FINAL VERIFICATION ---
RUN ls -lh $LIBPOSTAL_DATA_DIR/transliteration/transliteration.dat

WORKDIR /app
COPY server.js .

CMD ["node", "server.js"]