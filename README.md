# Purifier

纯净小说与论坛阅读应用：**Go 1.22+ Chi API + Vite React 19 SPA**。抓取并安全清洗论坛与小说书库内容，提供极致轻量、排版干净、适配全端的阅读体验。

## 核心特性

- **内容源垂直切片（Vertical Slice）**：论坛源（Cool18）与小说源（XChina）业务与模型彻底隔离。
- **个人资产中心**：统一归口于 `/api/v1/me/*`，跨站聚合阅读历史、收藏、标签、书签、阅读进度与阅读统计。
- **现代化阅读体验**：支持跟帖评论树折叠浏览、角色颜色高亮关联聚类、字号行距偏好设置、深色/浅色自适应主题。
- **生产级后端架构**：纯 Go 静态编译、Singleflight 防击穿、二级磁盘原子缓存、标准 ANSI SQL DAO（为平迁 PG 做好完整解耦准备）。
- **标准 OIDC 认证**：支持 Pocket-ID / Keycloak PKCE 授权码登录与 JWT 会话管理。
- **极致轻量容器**：生产 Docker 镜像仅约 **21.8 MB**，毫秒级快速启动。

## 技术栈

- **后端**：Go 1.22+，Chi (`go-chi/chi/v5`)，modernc.org/sqlite (预备一键平迁 PostgreSQL)，goquery
- **前端**：Vite + React 19 + React Router 7 + Tailwind CSS 4 + shadcn/ui (Base UI 原语)
- **容器**：Alpine Linux 极精简运行时 + 预置非 root 安全用户与健康探针

## 目录结构

```text
backend/                # Go 后端工程
├── cmd/server/         # 服务启动入口、优雅停机
├── internal/
│   ├── config/         # 环境变量配置
│   ├── core/           # 核心网络池、Singleflight 防击穿、DOM 遍历安全清洗管道
│   ├── storage/        # 持久化存储 DAO (标准 ANSI SQL)
│   ├── provider/       # 垂直内容源领域 (Cool18 论坛 / XChina 书库)
│   ├── jobs/           # 异步归档任务系统
│   ├── auth/           # OIDC Discovery 与会话鉴权
│   └── api/            # Chi 总路由、v1 切片、兼容层与前端 SPA 托管
frontend/               # Vite + React 19 前端工程
├── src/
│   ├── components/ui/  # 标准 shadcn/ui 组件
│   ├── pages/          # 业务页面级组件
│   └── lib/            # 前端路由、API 客户端与鉴权
Dockerfile              # 生产极简多阶段构建单镜像
AGENTS.md               # 团队工程规范与运维发布运维指南
```

## 快速开始

### 本地开发

1. **启动后端服务**（默认端口 `:3001`）：
   ```bash
   cd backend
   go run ./cmd/server
   ```

2. **启动前端开发服务器**（端口 `:3000`，自动代理 `/api` 到 `:3001`）：
   ```bash
   cd frontend
   bun install
   bun run dev
   ```

### 自动化测试与检查

```bash
# 后端测试
cd backend && go test ./...

# 前端类型检查与构建
cd frontend && bun run typecheck && bun run build
```

## 生产运行 (Docker)

```bash
docker build -t purifier:latest .
docker run -d -p 3000:3000 -v purifier_data:/data purifier:latest
```

运维发布、数据安全备份与回滚详情参见 [AGENTS.md](AGENTS.md)。
