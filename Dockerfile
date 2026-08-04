# Purifier: slim production image
# - builder: full monorepo install → Vite SPA
# - runner: only api + core production deps + dist
# Base: DaoCloud Bun mirror (China). Override:
#   docker build --build-arg BUN_IMAGE=oven/bun:1.3 .

ARG BUN_IMAGE=docker.m.daocloud.io/oven/bun:1.3

# ---------- full install for frontend build ----------
FROM ${BUN_IMAGE} AS monorepo-deps
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/ui/package.json ./packages/ui/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN bun install --frozen-lockfile

FROM ${BUN_IMAGE} AS web-builder
WORKDIR /app
COPY --from=monorepo-deps /app/ ./
COPY apps/web ./apps/web
COPY packages/ui ./packages/ui
COPY packages/typescript-config ./packages/typescript-config
RUN cd apps/web && bunx vite build

# ---------- production deps: api + core only ----------
FROM ${BUN_IMAGE} AS api-deps
WORKDIR /app
COPY .npmrc ./
# Minimal workspace: api + core (+ typescript-config only as workspace stub for package.json refs)
RUN printf '%s\n' \
  '{' \
  '  "name": "purifier",' \
  '  "private": true,' \
  '  "workspaces": ["apps/api", "packages/core", "packages/typescript-config"],' \
  '  "packageManager": "bun@1.3.14"' \
  '}' > package.json
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/core ./packages/core
COPY packages/typescript-config ./packages/typescript-config
COPY apps/api ./apps/api
# Production graph only (cheerio etc.); no vite/turbo/web
RUN bun install --production

# ---------- runtime ----------
FROM ${BUN_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WEB_DIST=/app/apps/web/dist

COPY --from=api-deps /app/package.json ./
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-deps /app/apps/api ./apps/api
COPY --from=api-deps /app/packages/core ./packages/core
COPY --from=api-deps /app/packages/typescript-config ./packages/typescript-config
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
USER bun
CMD ["bun", "run", "apps/api/src/index.ts"]
