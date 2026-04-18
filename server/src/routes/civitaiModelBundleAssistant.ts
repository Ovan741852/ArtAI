import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import {
  prepareModelBundleAssistantTurn,
  runModelBundleAssistantChat,
  writeModelBundleAssistantChatStream,
  type ModelBundleAssistantBody,
  type PreparedModelBundleAssistantTurn,
} from '../services/civitaiModelBundleAssistant.js'

export function createCivitaiModelBundleAssistantRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 多輪對話：由 Ollama 產出繁中短回覆與最多 3 組「Checkpoint + 可選 LoRA」英文搜尋條件，再向 Civitai 合併搜尋。
   * 可選 `imageBase64`／`imageBase64s`（須視覺模型）。
   */
  r.post('/civitai/model-bundles/assistant/chat', async (c) => {
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
      const result = await runModelBundleAssistantChat(env, body as ModelBundleAssistantBody)
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
   * 與 `POST .../chat` 相同 body，改以 **NDJSON 串流**回傳。
   */
  r.post('/civitai/model-bundles/assistant/chat-stream', async (c) => {
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

    let prep: PreparedModelBundleAssistantTurn
    try {
      prep = await prepareModelBundleAssistantTurn(env, body as ModelBundleAssistantBody)
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
          await writeModelBundleAssistantChatStream(env, body as ModelBundleAssistantBody, writeLine, {
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
