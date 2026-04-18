import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { fetchCheckpointList } from '../services/comfyuiCheckpoints.js'

export function createComfyCheckpointRoutes(env: ServerEnv) {
  const r = new Hono()

  /** 目前 ComfyUI `models/checkpoints` 目錄下有哪些檔（含副檔名）。 */
  r.get('/comfy/checkpoints', async (c) => {
    try {
      const checkpoints = await fetchCheckpointList(env.comfyuiBaseUrl)
      return c.json({
        ok: true,
        checkpoints,
        comfyuiBaseUrl: env.comfyuiBaseUrl,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
