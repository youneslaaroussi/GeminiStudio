# syntax=docker/dockerfile:1.6

FROM node:20-slim AS base

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@9

# Copy workspace config and package manifests for dependency installation
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY scene/package.json ./scene/
COPY scene-compiler/package.json scene-compiler/tsconfig.json scene-compiler/tsconfig.build.json ./scene-compiler/

RUN pnpm install --filter @gemini-studio/scene-compiler... --filter @gemini-studio/scene... --prefer-offline

# Copy source files
COPY scene/ ./scene/
COPY scene-compiler/ ./scene-compiler/

# Build the compiler service
RUN pnpm --filter @gemini-studio/scene-compiler build

# --- Production stage ---
FROM node:20-slim AS production

ENV NODE_ENV=production

WORKDIR /app/scene-compiler

# Copy node_modules from build stage
COPY --from=base /app/node_modules ../node_modules
COPY --from=base /app/scene-compiler/node_modules ./node_modules
COPY --from=base /app/scene-compiler/dist ./dist
COPY --from=base /app/scene-compiler/package.json ./package.json

# Copy the base scene source for runtime compilation
COPY --from=base /app/scene ./base-scene

# Point the compiler at the base scene directory
ENV BASE_SCENE_DIR=/app/scene-compiler/base-scene

EXPOSE 4001

CMD ["node", "dist/index.js"]
