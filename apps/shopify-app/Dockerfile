FROM node:20-alpine
RUN apk add --no-cache openssl
RUN npm install -g pnpm

EXPOSE 3000

WORKDIR /workspace

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Copy manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/shopify-app/package.json apps/shopify-app/
COPY packages/contracts/ packages/contracts/

# Install dependencies (including dev deps for build)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter @orbitcheck/orbitcheck-shopify-app... --frozen-lockfile --ignore-scripts

# Build contracts manually
RUN pnpm --filter @orbitcheck/contracts run build

# Build
COPY . .
RUN pnpm --filter @orbitcheck/orbitcheck-shopify-app run build

# Deploy to /app
RUN pnpm --filter @orbitcheck/orbitcheck-shopify-app deploy --prod /app

WORKDIR /app

CMD ["pnpm", "run", "docker-start"]
