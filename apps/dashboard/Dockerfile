# Stage 1: Build the React application
FROM docker.io/library/node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Adjust the build command if necessary (e.g., npm run build)
RUN npm run build

# Stage 2: Create the final, small image with only the static files
FROM docker.io/library/nginx:1.27-alpine
# Copy the built static files from the 'builder' stage
COPY --from=builder /app/build /usr/share/nginx/html
# Nginx will serve files from this directory by default
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]