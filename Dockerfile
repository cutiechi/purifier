# syntax=docker/dockerfile:1.7
# ========================================================
# Purifier: Production Multi-stage Dockerfile (2026 Architecture)
#
# 极致优化亮点：
# 1. BuildKit Cache Mount: 依赖与编译缓存秒级复用
# 2. 纯 Go 零 CGO 静态单文件编译 (-trimpath -ldflags="-s -w")
# 3. Alpine 精简: 保留必要时区并剥离 tzdata 大包
# 4. COPY --chown: 杜绝镜像层二次 chown 引起的文件体积翻倍
# 5. 内置原生无依赖 HEALTHCHECK 探针 (基于 busybox wget)
# 6. 预创建非 root 用户 (UID 10001) 最小权限安全运行
#
# 自定义基础镜像（内网 / 加速器）：
#   docker build --build-arg BUN_IMAGE=docker.m.daocloud.io/oven/bun:1.2 \
#                --build-arg GOLANG_IMAGE=docker.m.daocloud.io/golang:1.24-alpine \
#                --build-arg RUNTIME_IMAGE=docker.m.daocloud.io/alpine:3.21 .
# ========================================================

ARG BUN_IMAGE=oven/bun:1.4
ARG GOLANG_IMAGE=golang:1.24-alpine
ARG RUNTIME_IMAGE=alpine:3.21

# ---------- Stage 1: Build Frontend SPA ----------
FROM ${BUN_IMAGE} AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/bun.lock ./
# 利用 BuildKit 缓存持久化 bun 包缓存
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY frontend/ ./
RUN bun run build

# ---------- Stage 2: Build Backend Binary ----------
FROM ${GOLANG_IMAGE} AS backend-builder
WORKDIR /app/backend

COPY backend/go.mod backend/go.sum ./
# 利用 BuildKit 缓存 Go 模块下载
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY backend/ ./
# 开启编译缓存并去除符号表与调试信息 (-s -w -trimpath)
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w -buildid=" \
    -o /app/purifier ./cmd/server

# ---------- Stage 3: Minimal Secure Production Runner ----------
FROM ${RUNTIME_IMAGE} AS runner
WORKDIR /app

# 安装 CA 根证书用于外部爬虫 TLS，提取必要时区后清除 tzdata 包缩减体积
RUN apk add --no-cache ca-certificates tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata && \
    addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S appuser -G appgroup && \
    mkdir -p /data && \
    chown -R 10001:10001 /data

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIST=/app/web \
    TZ=Asia/Shanghai

# 使用 --chown 直接在写入层设置非 root 权限，避免二次 chown 导致镜像膨胀
COPY --from=backend-builder --chown=10001:10001 /app/purifier /app/purifier
COPY --from=frontend-builder --chown=10001:10001 /app/frontend/dist /app/web

USER 10001:10001

EXPOSE 3000
VOLUME ["/data"]

# 生产级零额外依赖健康检查（利用 Alpine 原生 wget 探测 /api/health）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["/app/purifier"]
