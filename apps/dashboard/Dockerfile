# Stage 1: Build the React application
FROM docker.io/library/node:20-alpine AS builder
RUN apk add --no-cache pnpm
WORKDIR /app
# Copy workspace files for pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile
COPY . .
# Adjust the build command if necessary (e.g., npm run build)
RUN pnpm --filter @orbitcheck/dashboard run build

# Stage 2: Create the final, small image with only the static files
FROM docker.io/library/nginx:1.27-alpine
# Copy the built static files from the 'builder' stage
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
# Nginx will serve files from this directory by default
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]