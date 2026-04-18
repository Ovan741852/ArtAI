import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import {
  runCheckpointTagAssistantChat,
  type CheckpointTagAssistantBody,
} from '../services/civitaiCheckpointTagAssistant.js'

export function createCivitaiCheckpointTagAssistantRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 多輪對話：依本機 checkpoint 清單（與目錄 tags）＋使用者訊息，由 Ollama 產出繁中回覆與英文 tag／query，再向 Civitai 合併搜尋推薦 Checkpoint。
   * 可選 `imageBase64` 附參考圖（Ollama `/api/generate` 之 `images`）；須選視覺模型。
   */
  r.post('/civitai/checkpoint/tag-assistant/chat', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Invalid JSON body' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }

    try {
      const result = await runCheckpointTagAssistantChat(env, body as CheckpointTagAssistantBody)
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
