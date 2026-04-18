import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import {
  prepareWorkflowAssistantTurn,
  runWorkflowAssistantChat,
  writeWorkflowAssistantChatStream,
  type WorkflowAssistantBody,
  type PreparedWorkflowAssistantTurn,
} from '../services/workflowAssistantChat.js'

export function createWorkflowAssistantRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * Workflow 模板助手（單次 JSON）：依本機模板、Comfy checkpoint、可選 `object_info` 摘要，由 Ollama 產出繁中回覆與結構化 patch。
   */
  r.post('/workflows/assistant/chat', async (c) => {
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
      const result = await runWorkflowAssistantChat(env, body as WorkflowAssistantBody)
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
  r.post('/workflows/assistant/chat-stream', async (c) => {
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

    let prep: PreparedWorkflowAssistantTurn
    try {
      prep = await prepareWorkflowAssistantTurn(env, body as WorkflowAssistantBody)
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
          await writeWorkflowAssistantChatStream(env, body as WorkflowAssistantBody, writeLine, {
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
