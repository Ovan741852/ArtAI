import { HttpPacket, HttpRequest } from '../http/types'

/** 示範：POST JSON，回應可走 mock 的 extend 字串包一層。 */
export class DemoEchoReq extends HttpRequest {
  private text = ''

  onAllocate(text: string): void {
    this.text = text
  }

  get url(): string {
    return '/demo/echo'
  }
  get method(): 'POST' {
    return 'POST'
  }
  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }
  get responseType(): 'json' {
    return 'json'
  }
  get body(): string {
    return JSON.stringify({ text: this.text })
  }
}

export class DemoEchoRsp extends HttpPacket {
  ok = false
  echo: Record<string, unknown> = {}

  decode(payload: unknown): void {
    if (payload == null || typeof payload !== 'object') {
      this.ok = false
      this.echo = {}
      return
    }
    const o = payload as { ok?: boolean; echo?: unknown }
    this.ok = Boolean(o.ok)
    if (o.echo != null && typeof o.echo === 'object') {
      this.echo = o.echo as Record<string, unknown>
    } else {
      this.echo = {}
    }
  }
}
