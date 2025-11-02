# libpostal.base.Dockerfile
# Use the correct variable for the target platform: $TARGETPLATFORM
FROM --platform=$TARGETPLATFORM debian:bookworm-slim as build
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/libpostal

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential autoconf automake libtool pkg-config \
  && rm -rf /var/lib/apt/lists/*

ARG LIBPOSTAL_REF=v1.1
# This is the corrected RUN command with the final fix
RUN git clone --depth 1 --branch ${LIBPOSTAL_REF} https://github.com/openvenues/libpostal.git . \
  && ./bootstrap.sh \
  # FIX: Remove x86-specific flags and defines from the configure script
  && sed -i 's/-msse2//g' configure \
  && sed -i 's/-mfpmath=sse//g' configure \
  && sed -i 's/-DUSE_SSE//g' configure \
  && ./configure --datadir=/opt/libpostal/data \
  && make -j"$(nproc)" \
  && make install \
  && ldconfig

# Download models once (≈1.8–2.2 GB on disk)
RUN /opt/libpostal/src/libpostal_data download all /opt/libpostal/data

# Optional: slim a bit
RUN strip /usr/local/lib/*.so* || true

# Also use the correct variable in the final stage
FROM --platform=$TARGETPLATFORM debian:bookworm-slim
COPY --from=build /usr/local/ /usr/local/
COPY --from=build /opt/libpostal/data /opt/libpostal/data
ENV LIBPOSTAL_DATA_DIR=/opt/libpostal/data
RUN ldconfig