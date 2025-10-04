# Use the official Caddy builder image which contains the 'xcaddy' tool
FROM caddy:2-builder AS builder

# Build a new Caddy binary with the cache-handler plugin
RUN xcaddy build \
    --with github.com/caddyserver/cache-handler

# Start a new, clean stage with the final Caddy image
FROM caddy:2

# Copy our custom-built Caddy binary from the builder stage
COPY --from=builder /usr/bin/caddy /usr/bin/caddy