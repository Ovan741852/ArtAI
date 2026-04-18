import { Hono } from 'hono'

/**
 * 與 `web/src/net/protocol/demoEcho.ts` 對齊：POST JSON body，回 `{ ok, echo }`。
 * `echo` 為解析後的 JSON 物件（與前端 `normalizePacketPayload` 相容）。
 */
export const demoEchoRoutes = new Hono()

demoEchoRoutes.post('/demo/echo', async (c) => {
  let body: unknown = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  if (body == null || typeof body !== 'object') {
    body = { value: body }
  }
  return c.json({ ok: true, echo: body as Record<string, unknown> })
})
