FROM node:22-bookworm-slim AS app
WORKDIR /app
RUN npm i -g zx
COPY *.mjs .
ENTRYPOINT ["zx", "script.mjs"]