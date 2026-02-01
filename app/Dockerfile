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

# Production stage - use standalone output
FROM node:20-alpine AS production

WORKDIR /app

# Don't run as root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build (includes server + required node_modules)
COPY --from=base --chown=nextjs:nodejs /app/app/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/app/.next/static ./.next/static
COPY --from=base --chown=nextjs:nodejs /app/app/public ./public

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Standalone server is at server.js
CMD ["node", "server.js"]
