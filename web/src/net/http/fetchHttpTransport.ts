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
      const message = `HTTP ${res.status}: ${res.statusText}`
      throw { kind, message, status: res.status }
    }

    if (req.responseType === 'json') {
      return (await res.json()) as unknown
    }
    return (await res.text()) as unknown
  }
}
