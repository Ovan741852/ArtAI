import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError, runCheckpointSummary, type CheckpointSummaryBody } from '../services/civitaiCheckpointSummary.js'

export function createCivitaiCheckpointSummaryRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 依本機 checkpoint 檔名查 Civitai → 擷取 description / trainedWords / baseModel → 交本地 Ollama 產生繁中用法摘要。
   * Body: `{ "checkpoint": "foo.safetensors", "ollamaModel"?: "llama3.2:latest" }`
   */
  r.post('/civitai/checkpoint/summary', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }

    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Request body must be a JSON object' }, 400)
    }

    try {
      const result = await runCheckpointSummary(env, body as CheckpointSummaryBody)
      return c.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const code = e.status === 400 || e.status === 404 ? e.status : 502
        return c.json({ ok: false, message: e.message }, code)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
