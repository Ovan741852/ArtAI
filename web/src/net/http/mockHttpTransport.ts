import type { IHttpRequest } from './types'
import { normalizePacketPayload } from './payload'

/**
 * 離線驗證用：模擬「extend 內嵌 JSON 字串」這類常見後端形狀。
 */
export class MockHttpTransport {
  async execute(req: IHttpRequest & { url: string }): Promise<unknown> {
    if (req.url.includes('/demo/echo')) {
      let parsed: unknown = {}
      const b = req.body
      if (typeof b === 'string' && b.trim()) {
        try {
          parsed = JSON.parse(b) as unknown
        } catch {
          parsed = { raw: b }
        }
      } else if (b && typeof b === 'object' && !(b instanceof URLSearchParams)) {
        parsed = b
      }

      return {
        extend: JSON.stringify({ ok: true, echo: parsed }),
      }
    }

    return normalizePacketPayload({})
  }
}
