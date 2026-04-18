import { HttpPacket, HttpRequest } from '../http/types'

export type CatalogSyncFailure = {
  localFilename: string
  message: string
  keptStale: boolean
}

export class CatalogSyncFromComfyReq extends HttpRequest {
  get url(): string {
    return '/catalog/checkpoints/sync-from-comfy'
  }

  get method(): 'POST' {
    return 'POST'
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  get body(): string {
    return '{}'
  }

  get responseType(): 'json' {
    return 'json'
  }
}

export class CatalogSyncFromComfyRsp extends HttpPacket {
  ok = false
  message = ''
  comfyCheckpointCount = 0
  persistedCount = 0
  refreshedCount = 0
  staleKeptCount = 0
  failures: CatalogSyncFailure[] = []

  decode(payload: unknown): void {
    if (payload == null || typeof payload !== 'object') {
      this.ok = false
      this.message = '回應格式異常'
      return
    }
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.ok = false
      this.message = typeof o.message === 'string' ? o.message : '同步失敗'
      return
    }
    this.ok = true
    this.message = ''
    this.comfyCheckpointCount = typeof o.comfyCheckpointCount === 'number' ? o.comfyCheckpointCount : 0
    this.persistedCount = typeof o.persistedCount === 'number' ? o.persistedCount : 0
    this.refreshedCount = typeof o.refreshedCount === 'number' ? o.refreshedCount : 0
    this.staleKeptCount = typeof o.staleKeptCount === 'number' ? o.staleKeptCount : 0
    const raw = o.failures
    const out: CatalogSyncFailure[] = []
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (row == null || typeof row !== 'object') continue
        const f = row as Record<string, unknown>
        if (typeof f.localFilename !== 'string') continue
        out.push({
          localFilename: f.localFilename,
          message: typeof f.message === 'string' ? f.message : '',
          keptStale: f.keptStale === true,
        })
      }
    }
    this.failures = out
  }
}
