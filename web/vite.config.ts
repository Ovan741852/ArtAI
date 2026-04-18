import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 與 artist-ai.py 相同：預設轉發到 http://127.0.0.1:11434
// 若 Ollama 在別台／Docker 內網，可在專案根目錄 .env 設定：
// OLLAMA_PROXY_TARGET=http://127.0.0.1:11434
// 或（視環境）http://host.docker.internal:11434
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ollamaTarget = env.OLLAMA_PROXY_TARGET || 'http://127.0.0.1:11434'
  const comfyTarget = env.COMFYUI_PROXY_TARGET || 'http://127.0.0.1:8188'
  const artaiServerTarget = env.ARTAI_SERVER_URL || 'http://127.0.0.1:8787'

  return {
    plugins: [react()],
    server: {
      // 與 package.json 的 `vite --host` 一致：區網可連
      host: true,
      // 用 http://192.168.x.x:5173 開頁時，Vite 預設會因 Host 檢查回 403；開發期允許任意 Host
      allowedHosts: true,
      proxy: {
        '/ollama': {
          target: ollamaTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ollama/, ''),
        },
        '/comfy': {
          target: comfyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/comfy/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // ComfyUI 會對 Origin/Host 做安全檢查；經 Vite proxy 時移除 Origin 可避免被 403 拒絕
              proxyReq.removeHeader('origin')
            })
          },
        },
        // 開發期：前端 `fetch('/api/...')` → ArtAI Node server（見 `server/`）
        '/api': {
          target: artaiServerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // 減少開發代理對串流／大 body 的壓縮與緩衝問題
              proxyReq.setHeader('Accept-Encoding', 'identity')
            })
          },
        },
      },
    },
  }
})
