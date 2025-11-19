# syntax=docker/dockerfile:1
# libpostal.base.Dockerfile

# Use Debian Bookworm as the builder
FROM debian:bookworm-slim AS build

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/libpostal

# 1. Install Build Dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential autoconf automake libtool pkg-config \
  && rm -rf /var/lib/apt/lists/*

# 2. Clone & Build Libpostal (C Library)
ARG LIBPOSTAL_REF=v1.1
RUN git clone --depth 1 --branch ${LIBPOSTAL_REF} https://github.com/openvenues/libpostal.git . \
  && ./bootstrap.sh \
  # DISABLE SSE for compatibility (Critical for ARM/Apple Silicon/Cloud Run)
  && sed -i 's/-msse2//g' configure \
  && sed -i 's/-mfpmath=sse//g' configure \
  && sed -i 's/-DUSE_SSE//g' configure \
  && ./configure --datadir=/opt/libpostal/data \
  && make -j"$(nproc)" \
  && make install

# 3. Download Model Data (~2GB)
RUN /usr/local/bin/libpostal_data download all /opt/libpostal/data

# 4. Cleanup/Strip binaries to reduce size
RUN strip /usr/local/lib/libpostal.so.1.0.0 || true

# --- Final Base Stage ---
FROM debian:bookworm-slim

# A) Copy Headers (Needed for node-gyp to compile bindings)
COPY --from=build /usr/local/include /usr/local/include

# B) Copy Libraries (The .so files)
COPY --from=build /usr/local/lib /usr/local/lib

# C) Copy Data (The heavy 2GB models)
COPY --from=build /opt/libpostal/data /opt/libpostal/data

# D) Update System Linker
# This ensures /usr/local/lib is recognized immediately
RUN ldconfig