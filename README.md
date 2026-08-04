# Purifier

Cool18 净化阅读：Bun API + Vite SPA。

## 开发

```bash
bun install
bun run dev:api   # :3001
bun run dev:web   # :3000，/api 代理到 3001
```

## 生产

```bash
bun run build:web
PORT=3000 bun run start   # 单进程：API + 静态页
```

## Docker

```bash
docker build -t purifier:latest .
docker run -p 3000:3000 -e HTTPS_PROXY=http://host:7890 purifier:latest
```
