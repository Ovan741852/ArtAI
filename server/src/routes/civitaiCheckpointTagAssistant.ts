import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import {
  prepareCheckpointTagAssistantTurn,
  runCheckpointTagAssistantChat,
  writeCheckpointTagAssistantChatStream,
  type CheckpointTagAssistantBody,
  type PreparedCheckpointTagAssistantTurn,
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
    } catch (e) {
      const hint = e instanceof Error && /Unexpected end|JSON/i.test(e.message) ? '（請求 body 是否過大？）' : ''
      return c.json({ ok: false, message: `Invalid JSON body${hint}` }, 400)
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

  /**
   * 與 `POST .../chat` 相同 body，改以 **NDJSON 串流**回傳：每行一個 JSON。
   * - `{ "type": "delta", "text": "..." }`：Ollama 產生片段
   * - `{ "type": "final", "ok": true, ... }`：與非串流成功 JSON 相同欄位
   * - `{ "type": "error", "ok": false, "message": "..." }`：失敗
   */
  r.post('/civitai/checkpoint/tag-assistant/chat-stream', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      const hint = e instanceof Error && /Unexpected end|JSON/i.test(e.message) ? '（請求 body 是否過大？）' : ''
      return c.json({ ok: false, message: `Invalid JSON body${hint}` }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }

    let prep: PreparedCheckpointTagAssistantTurn
    try {
      prep = await prepareCheckpointTagAssistantTurn(env, body as CheckpointTagAssistantBody)
    } catch (e) {
      if (e instanceof AppHttpError) {
        const code = e.status === 400 || e.status === 404 ? e.status : 502
        return c.json({ ok: false, message: e.message }, code)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }

    c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    c.header('Cache-Control', 'no-cache, no-transform')
    c.header('X-Accel-Buffering', 'no')

    return stream(
      c,
      async (s) => {
        const encoder = new TextEncoder()
        const writeLine = async (obj: unknown) => {
          await s.write(encoder.encode(`${JSON.stringify(obj)}\n`))
        }
        try {
          await writeCheckpointTagAssistantChatStream(env, body as CheckpointTagAssistantBody, writeLine, {
            signal: c.req.raw.signal,
            prep,
          })
        } catch (e) {
          const message = e instanceof AppHttpError ? e.message : e instanceof Error ? e.message : String(e)
          await writeLine({ type: 'error', ok: false, message })
        }
      },
      async (e, s) => {
        const encoder = new TextEncoder()
        const message = e instanceof Error ? e.message : String(e)
        await s.write(encoder.encode(`${JSON.stringify({ type: 'error', ok: false, message })}\n`))
      },
    )
  })

  return r
}
