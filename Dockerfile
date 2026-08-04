# Purifier: Vite SPA + pure Bun API (single process)
# China mirrors: DaoCloud base + npmmirror via .npmrc

ARG BUN_IMAGE=docker.m.daocloud.io/oven/bun:1.3

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/ui/package.json ./packages/ui/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN bun install --frozen-lockfile

FROM ${BUN_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/bun.lock ./
COPY package.json bun.lock turbo.json tsconfig.json .npmrc ./
COPY apps ./apps
COPY packages ./packages
ENV NODE_ENV=production
RUN bun run --filter=web build

FROM ${BUN_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WEB_DIST=/app/apps/web/dist

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/bun.lock ./
COPY package.json bun.lock ./
COPY apps/api ./apps/api
COPY packages/core ./packages/core
COPY packages/typescript-config ./packages/typescript-config
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
CMD ["bun", "run", "apps/api/src/index.ts"]
