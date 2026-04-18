import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { fetchCheckpointList } from '../services/comfyuiCheckpoints.js'
import { getComfyObjectInfoCached } from '../services/comfyuiObjectInfo.js'

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

  /**
   * ComfyUI `GET /object_info`（節點定義；回應可能很大）。Query：`force=1` 略過伺服器記憶體快取。
   */
  r.get('/comfy/object_info', async (c) => {
    try {
      const force = c.req.query('force') === '1' || c.req.query('force') === 'true'
      const hit = await getComfyObjectInfoCached(env.comfyuiBaseUrl, env.comfyObjectInfoTtlMs, { force })
      return c.json({
        ok: true,
        objectInfo: hit.objectInfo,
        comfyuiBaseUrl: hit.comfyuiBaseUrl,
        fromCache: hit.fromCache,
        refreshedAt: hit.refreshedAt,
        nodeTypeCount: hit.nodeTypeCount,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
