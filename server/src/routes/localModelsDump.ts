import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { getLocalModelsDump } from '../services/localModelsDump.js'

export function createLocalModelsDumpRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 本機模型彙整：ComfyUI checkpoints、Ollama 已安裝模型、本機 checkpoint 目錄（Civitai 同步 JSON）。
   * Query：`force=1` 略過快取立即重抓。`refreshedAt` 為上次成功建立快照的時間。
   */
  r.get('/models/local/dump', async (c) => {
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true' || c.req.query('force') === 'yes'
    try {
      const payload = await getLocalModelsDump(env, { force })
      return c.json(payload)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 500)
    }
  })

  return r
}
