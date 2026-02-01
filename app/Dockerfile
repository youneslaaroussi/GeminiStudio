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

# Build Next.js app - requires NEXT_PUBLIC_* env vars at build time
WORKDIR /app/app

# Firebase config (required at build time for Next.js static generation)
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

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
