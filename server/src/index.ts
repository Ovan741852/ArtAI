import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { serve } from '@hono/node-server'
import { createApp } from './app/createApp.js'
import { loadServerEnv } from './config/env.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadDotenv({ path: path.join(serverRoot, '.env') })

const env = loadServerEnv()
const app = createApp(env)

const server = serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    const addr = info && typeof info === 'object' && 'port' in info ? info.port : env.port
    console.log(`ArtAI server listening on http://127.0.0.1:${String(addr)}`)
  },
)

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[ArtAI] Port ${env.port} is already in use (often a previous \`npm run dev\` still running). ` +
        `End that Node process, or use another port: set PORT=8788`,
    )
    process.exit(1)
  }
  throw err
})
