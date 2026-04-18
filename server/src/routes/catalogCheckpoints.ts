import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { readOwnedCheckpointsCatalog, resolveOwnedCheckpointsStorePath } from '../services/ownedCheckpointsStore.js'
import { syncOwnedCheckpointsFromComfy } from '../services/syncOwnedCheckpointsFromComfy.js'

export function createCatalogCheckpointRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 讀取已同步的本機 checkpoint 目錄（JSON），每筆含 Comfy 檔名、Civitai 對應與 `GET /civitai/models/:id` 同等欄位的快取。
   */
  r.get('/catalog/checkpoints', async (c) => {
    try {
      const catalog = await readOwnedCheckpointsCatalog()
      return c.json({
        ok: true,
        storePath: resolveOwnedCheckpointsStorePath(),
        updatedAt: catalog.updatedAt || null,
        count: catalog.entries.length,
        entries: catalog.entries,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 500)
    }
  })

  /**
   * 向 ComfyUI 取得 `models/checkpoints` 檔名列表，逐筆在 Civitai 搜尋 Checkpoint 並以 `GET /api/v1/models/{id}` 拉完整資料後寫入本地 JSON 目錄。
   */
  r.post('/catalog/checkpoints/sync-from-comfy', async (c) => {
    try {
      const result = await syncOwnedCheckpointsFromComfy(env)
      return c.json({ ok: true, ...result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
