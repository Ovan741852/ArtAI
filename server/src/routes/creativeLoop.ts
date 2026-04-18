import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import { runCreativeLoopChat } from '../services/creativeLoopChat.js'
import { runCreativeLoopResourceCheck } from '../services/creativeLoopResourceCheck.js'

export function createCreativeLoopRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 創意閉環 panel：規劃層（Ollama + 可選多圖 + 可選上一張成品），回繁中與白名單 patch。
   */
  r.post('/images/creative-loop/chat', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      const hint = e instanceof Error && /Unexpected end|JSON/i.test(e.message) ? '（請求 body 是否過大？）' : ''
      return c.json({ ok: false, message: `Invalid JSON body${hint}` }, 400)
    }
    try {
      const result = await runCreativeLoopChat(env, body)
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

  /** 第二段：資源盤點 checklist（繁中 + Civitai 連結 + 本機 checkpoint 比對）。 */
  r.post('/images/creative-loop/resource-check', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      const hint = e instanceof Error && /Unexpected end|JSON/i.test(e.message) ? '（請求 body 是否過大？）' : ''
      return c.json({ ok: false, message: `Invalid JSON body${hint}` }, 400)
    }
    try {
      const result = await runCreativeLoopResourceCheck(env, body)
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
