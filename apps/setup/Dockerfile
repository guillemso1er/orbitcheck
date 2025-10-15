FROM node:22-bookworm-slim AS app
WORKDIR /app
RUN npm i -g zx
COPY script.mjs .
ENTRYPOINT ["zx", "script.mjs"]