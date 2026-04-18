import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { fetchOllamaTags } from '../services/ollamaTags.js'

export function createOllamaModelRoutes(env: ServerEnv) {
  const r = new Hono()

  /** 轉發本機 Ollama `GET /api/tags`，列出已安裝的模型。 */
  r.get('/ollama/models', async (c) => {
    try {
      const { models } = await fetchOllamaTags(env.ollamaBaseUrl)
      const modelNames = models.map((m) => m.name)
      return c.json({
        ok: true,
        ollamaBaseUrl: env.ollamaBaseUrl,
        models,
        modelNames,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
