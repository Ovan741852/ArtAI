import type { HttpPacket, IHttpRequest } from './types'
import { normalizePacketPayload } from './payload'
import type { NetResult } from './NetResult'
import { netErr, netOk, toNetError } from './NetResult'
import type { IHttpTransport } from './fetchHttpTransport'
import { FetchHttpTransport } from './fetchHttpTransport'
import { MockHttpTransport } from './mockHttpTransport'

function resolveUrl(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = baseUrl.replace(/\/+$/, '')
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  if (!base) return path
  return `${base}${path}`
}

export type HttpClientOptions = {
  baseUrl?: string
  transport?: IHttpTransport
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly transport: IHttpTransport

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      import.meta.env.VITE_API_BASE_URL ??
      (import.meta.env.DEV ? '/api' : '')
    this.transport = options.transport ?? new FetchHttpTransport()
  }

  /**
   * Request 物件 encode 後送出；ResponseCtor.decode 永遠收到 normalize 後的 payload。
   */
  async send<R extends HttpPacket>(
    request: IHttpRequest,
    ResponseCtor: new () => R,
  ): Promise<NetResult<R>> {
    try {
      const url = resolveUrl(this.baseUrl, request.url)
      const raw = await this.transport.execute({ ...request, url })
      const payload = normalizePacketPayload(raw)
      const packet = new ResponseCtor()
      packet.decode(payload)
      return netOk(packet)
    } catch (e) {
      return netErr(toNetError(e))
    }
  }

  /**
   * 與 Aerith 用法對齊：先 allocate 再 encode。
   */
  async sendRequest<Q extends { encode(): IHttpRequest }, R extends HttpPacket>(
    request: Q,
    ResponseCtor: new () => R,
  ): Promise<NetResult<R>> {
    return this.send(request.encode(), ResponseCtor)
  }
}

export function createDefaultHttpClient(): HttpClient {
  if (import.meta.env.VITE_NET_MOCK === '1') {
    return new HttpClient({ transport: new MockHttpTransport() })
  }
  return new HttpClient()
}
