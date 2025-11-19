# apps/address-service/Dockerfile
FROM ghcr.io/guillemso1er/orbitcheck/libpostal-base:latest AS base

FROM node:20-bookworm-slim
# 1. Copy the artifacts from your base image
COPY --from=base /usr/local/include /usr/local/include
COPY --from=base /usr/local/lib /usr/local/lib
COPY --from=base /opt/libpostal/data /opt/libpostal/data

# 2. Configure environment
ENV LIBPOSTAL_DATA_DIR=/opt/libpostal/data
ENV LD_LIBRARY_PATH=/usr/local/lib

# 3. Install Node dependencies (including node-postal)
WORKDIR /app
COPY package.json .
# The system now has the C libs, so this will compile successfully!
RUN npm install --build-from-source

COPY . .
CMD ["node", "server.js"]