import { HttpPacket, HttpRequest } from '../http/types'

export type ComfyCheckpointsOkData = {
  checkpoints: string[]
  comfyuiBaseUrl: string
}

export class ComfyCheckpointsReq extends HttpRequest {
  get url(): string {
    return '/comfy/checkpoints'
  }

  get method(): 'GET' {
    return 'GET'
  }

  get headers(): Record<string, string> {
    return {}
  }

  get responseType(): 'json' {
    return 'json'
  }
}

export class ComfyCheckpointsRsp extends HttpPacket {
  ok = false
  message = ''
  data: ComfyCheckpointsOkData | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    if (payload == null || typeof payload !== 'object') return
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.message = typeof o.message === 'string' ? o.message : '無法取得 checkpoint 清單'
      return
    }
    const raw = o.checkpoints
    const checkpoints: string[] = []
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string' && x.trim()) checkpoints.push(x.trim())
      }
    }
    this.ok = true
    this.data = {
      checkpoints,
      comfyuiBaseUrl: typeof o.comfyuiBaseUrl === 'string' ? o.comfyuiBaseUrl : '',
    }
  }
}
