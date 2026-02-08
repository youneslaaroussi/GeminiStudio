# syntax=docker/dockerfile:1.6

FROM ghcr.io/puppeteer/puppeteer:22.15.0 AS base

WORKDIR /app

USER root

# Install ffmpeg for video processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@9

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY app/package.json app/pnpm-workspace.yaml ./app/
COPY renderer/package.json renderer/tsconfig.json renderer/tsconfig.build.json ./renderer/
# app depends on local @ai-sdk/google (file:../ai-sdk/packages/google); workspace install resolves it
COPY ai-sdk/packages/google ./ai-sdk/packages/google
RUN pnpm install --filter @gemini-studio/renderer... --prefer-offline

COPY . .

# Scene is no longer bundled at build time; it is compiled on demand by the scene-compiler service.
RUN pnpm --filter @gemini-studio/renderer build

FROM base AS production

ENV NODE_ENV=production

WORKDIR /app/renderer

COPY --from=base /app/node_modules ../node_modules
COPY --from=base /app/renderer/dist ./dist
COPY --from=base /app/renderer/package.json ./package.json

EXPOSE 4000

CMD ["node", "dist/index.js"]
