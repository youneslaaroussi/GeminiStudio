# syntax=docker/dockerfile:1.6

FROM ghcr.io/puppeteer/puppeteer:22.15.0 AS base

WORKDIR /app

USER root

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@9

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY app/package.json app/pnpm-workspace.yaml ./app/
COPY scene/package.json ./scene/
COPY renderer/package.json renderer/tsconfig.json renderer/tsconfig.build.json ./renderer/
RUN pnpm install --filter @gemini-studio/renderer... --filter @gemini-studio/scene... --prefer-offline

COPY . .

RUN pnpm --filter @gemini-studio/scene build \
  && pnpm --filter @gemini-studio/renderer build

FROM base AS production

ENV NODE_ENV=production

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/renderer/dist ./renderer/dist
COPY --from=base /app/renderer/package.json ./renderer/package.json

EXPOSE 4000

CMD ["node", "renderer/dist/index.js"]
