import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import { runMattingAuto } from '../services/mattingAuto.js'

export function createMattingAutoRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 讀圖 → Ollama 視覺分類 → 依可用後端（Comfy 自訂節點 / Remove.bg / 本機 ONNX）自動摳圖。
   * Body: `{ "imageBase64": "…", "ollamaModel"?: "…" }`
   */
  r.post('/images/matting/auto', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }

    try {
      const result = await runMattingAuto(env, body)
      return c.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const code = e.status === 400 ? 400 : e.status === 500 ? 500 : 502
        const body: Record<string, unknown> = { ok: false, message: e.message }
        const ex = e.extra
        if (ex != null && typeof ex === 'object') {
          for (const [k, v] of Object.entries(ex)) {
            body[k] = v
          }
        }
        return c.json(body, code)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
