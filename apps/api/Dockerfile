# Start from the Node.js 18 image on Debian Bookworm
FROM node:18-bookworm

# Set the working directory for the application
WORKDIR /usr/src/app

# --- Build libpostal from source ---

# 1. Install the build dependencies required to compile C code
RUN apt-get update && apt-get install -y \
    curl \
    autoconf \
    automake \
    libtool \
    pkg-config \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. Clone the libpostal source code
RUN git clone https://github.com/openvenues/libpostal.git /opt/libpostal

# 3. Compile and install libpostal
WORKDIR /opt/libpostal
RUN ./bootstrap.sh && \
    ./configure --datadir=/opt/libpostal/data && \
    make -j$(nproc) && \
    make install && \
    ldconfig

# 4. Download the trained models
RUN /opt/libpostal/src/libpostal_data download all /opt/libpostal/data && \
    cp /opt/libpostal/src/.libs/address_parser /usr/local/bin/

# --- Set up the Node.js application ---

# Enable pnpm using corepack
RUN corepack enable

# Copy monorepo configuration files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the application source code (only necessary parts)
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src/ apps/api/src/
COPY apps/api/migrations/ apps/api/migrations/

# Build the TypeScript application
RUN cd apps/api && pnpm run build

# Expose the application port
EXPOSE 8080

# Define the command to run the app
CMD ["node", "apps/api/dist/server.js"]