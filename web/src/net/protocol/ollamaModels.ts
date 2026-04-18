import { HttpPacket, HttpRequest } from '../http/types'

/** 與後端 `GET /ollama/models` 回傳之 `models[]` 對齊的精簡欄位。 */
export type OllamaInstalledModel = {
  name: string
  model?: string
  modified_at?: string
  size?: number
  digest?: string
}

export type OllamaModelsOkData = {
  ollamaBaseUrl: string
  modelNames: string[]
  models: OllamaInstalledModel[]
}

export class OllamaModelsReq extends HttpRequest {
  get url(): string {
    return '/ollama/models'
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

export class OllamaModelsRsp extends HttpPacket {
  ok = false
  message = ''
  data: OllamaModelsOkData | null = null

  decode(payload: unknown): void {
    if (payload == null || typeof payload !== 'object') {
      this.ok = false
      this.message = '回應格式異常'
      this.data = null
      return
    }
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.ok = false
      this.message = typeof o.message === 'string' ? o.message : '無法取得 Ollama 模型清單'
      this.data = null
      return
    }
    const baseUrl = typeof o.ollamaBaseUrl === 'string' ? o.ollamaBaseUrl : ''
    const namesRaw = o.modelNames
    const modelNames: string[] = []
    if (Array.isArray(namesRaw)) {
      for (const x of namesRaw) {
        if (typeof x === 'string' && x.trim()) modelNames.push(x.trim())
      }
    }
    const models: OllamaInstalledModel[] = []
    const modelsRaw = o.models
    if (Array.isArray(modelsRaw)) {
      for (const row of modelsRaw) {
        if (row == null || typeof row !== 'object') continue
        const m = row as Record<string, unknown>
        if (typeof m.name !== 'string' || !m.name.trim()) continue
        models.push({
          name: m.name.trim(),
          model: typeof m.model === 'string' ? m.model : undefined,
          modified_at: typeof m.modified_at === 'string' ? m.modified_at : undefined,
          size: typeof m.size === 'number' ? m.size : undefined,
          digest: typeof m.digest === 'string' ? m.digest : undefined,
        })
      }
    }
    this.ok = true
    this.message = ''
    this.data = { ollamaBaseUrl: baseUrl, modelNames, models }
  }
}
