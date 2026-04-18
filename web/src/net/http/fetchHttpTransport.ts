import type { IHttpRequest } from './types'
import { prepareRequestForFetch } from './prepareBody'

export type IHttpTransport = {
  execute(resolved: IHttpRequest & { url: string }): Promise<unknown>
}

export class FetchHttpTransport implements IHttpTransport {
  async execute(req: IHttpRequest & { url: string }): Promise<unknown> {
    const prepared = prepareRequestForFetch(req, req.url)

    const res = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
    })

    if (!res.ok) {
      const kind = 'http' as const
      let detail = res.statusText || 'Request failed'
      const ct = res.headers.get('content-type') ?? ''
      try {
        const rawText = await res.text()
        if (ct.includes('application/json') && rawText.trim()) {
          const j = JSON.parse(rawText) as unknown
          if (j != null && typeof j === 'object' && 'message' in j) {
            const m = (j as { message?: unknown }).message
            if (typeof m === 'string' && m.trim()) detail = m.trim()
          }
        } else if (rawText.trim() && rawText.length < 400) {
          detail = rawText.trim().slice(0, 400)
        }
      } catch {
        /* keep detail */
      }
      throw { kind, message: `HTTP ${String(res.status)}: ${detail}`, status: res.status }
    }

    if (req.responseType === 'json') {
      return (await res.json()) as unknown
    }
    return (await res.text()) as unknown
  }
}
