import { HttpPacket, HttpRequest } from '../http/types'

export type CreativeLoopResourceKind = 'checkpoint' | 'lora' | 'vae' | 'other'

export type CreativeLoopResourceChecklistItem = {
  id: string
  kind: CreativeLoopResourceKind
  titleZh: string
  filename: string | null
  modelTags: string[]
  searchQueries: string[]
  detailZh?: string
  hasLocal: boolean
  browseUrl: string
}

export type CreativeLoopResourceCheckOkData = {
  ollamaModel: string
  resolvedTemplateId: string
  replyZh: string
  checklist: CreativeLoopResourceChecklistItem[]
  localCheckpoints: string[]
  noteZh: string
}

export class CreativeLoopResourceCheckReq extends HttpRequest {
  private payload: Record<string, unknown> = {}

  onAllocate(
    messages: { role: 'user' | 'assistant'; content: string }[],
    resolvedTemplateId: string,
    proposedPatch: Record<string, unknown>,
    opts?: { ollamaModel?: string },
  ): void {
    this.payload = {
      messages,
      resolvedTemplateId: resolvedTemplateId.trim(),
      proposedPatch,
      ...(opts?.ollamaModel ? { ollamaModel: opts.ollamaModel } : {}),
    }
  }

  get url(): string {
    return '/images/creative-loop/resource-check'
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
    return JSON.stringify(this.payload)
  }
}

function readStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  return x
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((s) => s.trim())
}

function parseChecklistItem(o: Record<string, unknown>): CreativeLoopResourceChecklistItem | null {
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
  const kindRaw = o.kind
  const kind: CreativeLoopResourceKind =
    kindRaw === 'checkpoint' || kindRaw === 'lora' || kindRaw === 'vae' || kindRaw === 'other' ? kindRaw : 'other'
  const titleZh = typeof o.titleZh === 'string' ? o.titleZh : ''
  const filename = o.filename === null ? null : typeof o.filename === 'string' ? o.filename : null
  if (!id || !titleZh.trim()) return null
  return {
    id,
    kind,
    titleZh: titleZh.trim(),
    filename: filename?.trim() || null,
    modelTags: readStringArray(o.modelTags),
    searchQueries: readStringArray(o.searchQueries),
    detailZh: typeof o.detailZh === 'string' && o.detailZh.trim() ? o.detailZh.trim() : undefined,
    hasLocal: o.hasLocal === true,
    browseUrl: typeof o.browseUrl === 'string' && o.browseUrl.trim() ? o.browseUrl.trim() : 'https://civitai.com/models',
  }
}

export class CreativeLoopResourceCheckRsp extends HttpPacket {
  ok = false
  message = ''
  data: CreativeLoopResourceCheckOkData | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    if (payload == null || typeof payload !== 'object') {
      this.message = '回應格式異常'
      return
    }
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.message = typeof o.message === 'string' ? o.message : '資源盤點失敗'
      return
    }
    const checklistRaw = o.checklist
    if (!Array.isArray(checklistRaw)) {
      this.message = '回應缺少 checklist'
      return
    }
    const checklist: CreativeLoopResourceChecklistItem[] = []
    for (const row of checklistRaw) {
      if (row == null || typeof row !== 'object') continue
      const item = parseChecklistItem(row as Record<string, unknown>)
      if (item) checklist.push(item)
    }
    if (checklist.length === 0) {
      this.message = 'checklist 為空'
      return
    }
    this.ok = true
    this.data = {
      ollamaModel: typeof o.ollamaModel === 'string' ? o.ollamaModel : '',
      resolvedTemplateId: typeof o.resolvedTemplateId === 'string' ? o.resolvedTemplateId : '',
      replyZh: typeof o.replyZh === 'string' ? o.replyZh : '',
      checklist,
      localCheckpoints: readStringArray(o.localCheckpoints),
      noteZh: typeof o.noteZh === 'string' ? o.noteZh : '',
    }
  }
}
