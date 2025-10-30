# infra/caddy/Containerfile
FROM caddy:2.10.2-builder AS builder 
ENV GOTOOLCHAIN=auto 
RUN xcaddy build --with github.com/caddyserver/cache-handler@v0.16.0

FROM caddy:2.10.2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy 
COPY /var/lib/containers/configs/caddy/Caddyfile /etc/caddy/Caddyfile


