FROM node:20-alpine
RUN apk add --no-cache openssl
RUN npm install -g pnpm

EXPOSE 3000

WORKDIR /workspace

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Build-time arguments for Vite environment variables
ARG VITE_API_BASE=https://api.orbitcheck.io
ENV VITE_API_BASE=$VITE_API_BASE

# --- CHANGE 1: REMOVE NODE_ENV=production FROM HERE ---

# Copy manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/shopify-app/package.json apps/shopify-app/
COPY packages/contracts/ packages/contracts/

# Install dependencies
# Without NODE_ENV=production, pnpm will now install devDependencies needed for building
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter @orbitcheck/orbitcheck-shopify-app... --frozen-lockfile --ignore-scripts

# Build contracts manually
RUN pnpm --filter @orbitcheck/contracts run build

# Build
COPY . .
RUN pnpm --filter @orbitcheck/orbitcheck-shopify-app run build

# Deploy to /app
RUN pnpm --filter @orbitcheck/orbitcheck-shopify-app deploy --prod /app

RUN cp -r apps/shopify-app/build /app/build
RUN cd /app && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" pnpm exec prisma generate

WORKDIR /app

# --- CHANGE 2: ADD NODE_ENV=production HERE (Runtime only) ---
ENV NODE_ENV=production

CMD ["pnpm", "run", "docker-start"]