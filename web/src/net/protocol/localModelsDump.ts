import { HttpPacket, HttpRequest } from '../http/types'

export type LocalModelsDumpData = {
  ok: true
  refreshedAt: string
  fromCache: boolean
  cacheTtlMs: number
  staleAt: string | null
  sources: {
    comfyui: {
      baseUrl: string
      ok: boolean
      checkpointCount: number
      checkpoints: string[]
      error?: string
    }
    ollama: {
      baseUrl: string
      ok: boolean
      modelCount: number
      modelNames: string[]
      error?: string
    }
    checkpointCatalog: {
      storePath: string
      catalogUpdatedAt: string | null
      entryCount: number
      entries: Array<{
        localFilename: string
        civitaiModelId: number
        civitaiVersionId: number
        matchQuality: string
        civitaiSearchQuery: string
        syncedAt: string
        civitaiModelName: string | null
      }>
    }
  }
  summary: {
    comfyCheckpointCount: number
    ollamaModelCount: number
    catalogEntryCount: number
  }
}

export class LocalModelsDumpReq extends HttpRequest {
  private force = false

  onAllocate(force?: boolean): void {
    this.force = Boolean(force)
  }

  get url(): string {
    return this.force ? '/models/local/dump?force=1' : '/models/local/dump'
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

export class LocalModelsDumpRsp extends HttpPacket {
  ok = false
  data: LocalModelsDumpData | null = null

  decode(payload: unknown): void {
    if (payload == null || typeof payload !== 'object') {
      this.ok = false
      this.data = null
      return
    }
    const o = payload as { ok?: unknown }
    if (o.ok !== true) {
      this.ok = false
      this.data = null
      return
    }
    this.ok = true
    this.data = payload as LocalModelsDumpData
  }
}
