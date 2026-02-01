# Next.js App Dockerfile
FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY scene/package.json ./scene/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY app ./app
COPY scene ./scene
COPY tsconfig.base.json ./

# Build scene first (dependency)
WORKDIR /app/scene
RUN pnpm run build

# Build Next.js app
WORKDIR /app/app
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

RUN npm install -g pnpm

# Copy built assets
COPY --from=base /app/app/.next ./.next
COPY --from=base /app/app/public ./public
COPY --from=base /app/app/package.json ./
COPY --from=base /app/app/node_modules ./node_modules
COPY --from=base /app/node_modules ./parent_node_modules

# Set node path to include parent modules
ENV NODE_PATH=/app/parent_node_modules

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

CMD ["pnpm", "start"]
