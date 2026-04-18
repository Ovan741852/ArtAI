import { HttpPacket, HttpRequest } from '../http/types'
import { parseAssistantResourceExtrasPayload, type AssistantResourceExtraOk } from './assistantResourceExtras'
export type { AssistantResourceExtraOk } from './assistantResourceExtras'

export type CheckpointTagAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type CheckpointTagAssistantCivitaiModel = {
  id: number
  name: string
  tags: string[]
  civitaiUrl: string
  descriptionText: string
}

export type CheckpointTagAssistantLocalRow = {
  localFilename: string
  civitaiTags: string[]
  civitaiModelName: string | null
  inCatalog: boolean
}

export type CheckpointTagAssistantOkData = {
  ollamaModel: string
  imageAttached: boolean
  /** 本輪送入 Ollama 的參考圖張數；舊伺服器可能未回傳，前端可 fallback。 */
  attachedImageCount: number
  localCheckpoints: CheckpointTagAssistantLocalRow[]
  assistant: {
    replyZh: string
    modelTags: string[]
    searchQueries: string[]
  }
  recommendedModels: CheckpointTagAssistantCivitaiModel[]
  resourceExtras: AssistantResourceExtraOk[]
}

function readStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const el of x) {
    if (typeof el === 'string' && el.trim()) out.push(el.trim())
  }
  return out
}

function parseLocalRows(raw: unknown): CheckpointTagAssistantLocalRow[] {
  if (!Array.isArray(raw)) return []
  const out: CheckpointTagAssistantLocalRow[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    if (typeof o.localFilename !== 'string') continue
    out.push({
      localFilename: o.localFilename,
      civitaiTags: readStringArray(o.civitaiTags),
      civitaiModelName: typeof o.civitaiModelName === 'string' ? o.civitaiModelName : null,
      inCatalog: o.inCatalog === true,
    })
  }
  return out
}

function parseRecommended(raw: unknown): CheckpointTagAssistantCivitaiModel[] {
  if (!Array.isArray(raw)) return []
  const out: CheckpointTagAssistantCivitaiModel[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    if (typeof o.id !== 'number' || typeof o.name !== 'string') continue
    const tags = readStringArray(o.tags)
    const civitaiUrl = typeof o.civitaiUrl === 'string' ? o.civitaiUrl : `https://civitai.com/models/${String(o.id)}`
    const descriptionText = typeof o.descriptionText === 'string' ? o.descriptionText : ''
    out.push({ id: o.id, name: o.name, tags, civitaiUrl, descriptionText })
  }
  return out
}

export class CheckpointTagAssistantChatReq extends HttpRequest {
  private payload: Record<string, unknown> = { messages: [] }

  onAllocate(
    messages: CheckpointTagAssistantMessage[],
    opts?: {
      ollamaModel?: string
      recommendLimit?: number
      imageBase64?: string | null
      imageBase64s?: string[] | null
    },
  ): void {
    const img = opts?.imageBase64?.trim()
    const imgs =
      opts?.imageBase64s?.map((s) => s.trim()).filter((s) => s.length > 0) ?? []
    this.payload = {
      messages,
      ...(opts?.ollamaModel ? { ollamaModel: opts.ollamaModel } : {}),
      ...(opts?.recommendLimit != null ? { recommendLimit: opts.recommendLimit } : {}),
      ...(img ? { imageBase64: img } : {}),
      ...(imgs.length > 0 ? { imageBase64s: imgs } : {}),
    }
  }

  get url(): string {
    return '/civitai/checkpoint/tag-assistant/chat'
  }

  get method(): 'POST' {
    return 'POST'
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  get body(): string {
    return JSON.stringify(this.payload)
  }

  get responseType(): 'json' {
    return 'json'
  }
}

export class CheckpointTagAssistantChatRsp extends HttpPacket {
  ok = false
  message = ''
  data: CheckpointTagAssistantOkData | null = null

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
      this.message = typeof o.message === 'string' ? o.message : '請求失敗'
      this.data = null
      return
    }
    const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : ''
    const imageAttached = o.imageAttached === true
    const attachedRaw = o.attachedImageCount
    const attachedImageCount =
      typeof attachedRaw === 'number' && Number.isFinite(attachedRaw)
        ? Math.max(0, Math.floor(attachedRaw))
        : imageAttached
          ? 1
          : 0
    const assistantRaw = o.assistant
    if (!assistantRaw || typeof assistantRaw !== 'object') {
      this.ok = false
      this.message = '回應缺少 assistant'
      this.data = null
      return
    }
    const a = assistantRaw as Record<string, unknown>
    const replyZh = typeof a.replyZh === 'string' ? a.replyZh : ''
    const modelTags = readStringArray(a.modelTags)
    const searchQueries = readStringArray(a.searchQueries)

    this.ok = true
    this.message = ''
    this.data = {
      ollamaModel,
      imageAttached,
      attachedImageCount,
      localCheckpoints: parseLocalRows(o.localCheckpoints),
      assistant: { replyZh, modelTags, searchQueries },
      recommendedModels: parseRecommended(o.recommendedModels),
      resourceExtras: parseAssistantResourceExtrasPayload(o.resourceExtras),
    }
  }
}
