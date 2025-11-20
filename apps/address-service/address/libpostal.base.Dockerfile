# syntax=docker/dockerfile:1
FROM debian:bookworm-slim AS build

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/libpostal

# 1. Install Build Dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential autoconf automake libtool pkg-config \
  && rm -rf /var/lib/apt/lists/*

# 2. Clone & Build Libpostal (using 'master')
ARG LIBPOSTAL_REF=master
RUN git clone --depth 1 --branch ${LIBPOSTAL_REF} https://github.com/openvenues/libpostal.git . \
  && ./bootstrap.sh \
  # DISABLE SSE for ARM/Cloud compatibility
  && sed -i 's/-msse2//g' configure \
  && sed -i 's/-mfpmath=sse//g' configure \
  && sed -i 's/-DUSE_SSE//g' configure \
  && ./configure --datadir=/opt/libpostal/data \
  && make -j"$(nproc)" \
  && make install

# 3. Download & VERIFY (Corrected Filenames)
RUN /usr/local/bin/libpostal_data download all /opt/libpostal/data \
  && echo "--- VERIFYING DATA DOWNLOAD ---" \
  && ls -lh /opt/libpostal/data/libpostal/transliteration/transliteration.dat \
  && ls -lh /opt/libpostal/data/libpostal/address_parser/address_parser_crf.dat

# 4. Cleanup
RUN strip /usr/local/lib/libpostal.so || true

# --- Final Base Stage ---
FROM debian:bookworm-slim

COPY --from=build /usr/local/include /usr/local/include
COPY --from=build /usr/local/lib /usr/local/lib
COPY --from=build /opt/libpostal/data /opt/libpostal/data

RUN ldconfig