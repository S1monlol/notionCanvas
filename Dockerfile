# Dockerfile for Node-based Astro server (dynamic/server output)

# ---- Build Stage ----
FROM node:21-alpine AS builder

WORKDIR /app

# Install dependencies first (leverage Docker cache)
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN \
    if [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm install; \
    elif [ -f yarn.lock ]; then npm i -g yarn && yarn install --frozen-lockfile; \
    else npm install; fi

# Copy the rest of the source code
COPY . .

RUN npx prisma generate

# Build the Astro project (must have "build" script in package.json)
RUN npm run build

# ---- Production Stage ----
FROM node:18-alpine AS runner

WORKDIR /app

# Copy only the built output and necessary files from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.astro ./.astro
COPY --from=builder /app/public ./public

COPY --from=builder /app/.env ./.env

# If your Astro server output uses a custom entrypoint, adjust below.
# By default, Astro outputs a server entry at ./dist/server/entry.mjs
COPY --from=builder /app/dist/server ./dist/server

# Start the Astro server
CMD npx prisma migrate deploy && npx prisma db push && node ./dist/server/entry.mjs
