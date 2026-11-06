import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        // API_PROXY 文档化默认 http://127.0.0.1:3001，多实例联调时可覆盖
        target: process.env.API_PROXY ?? "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
})
