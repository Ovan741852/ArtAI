import { HttpPacket, HttpRequest } from '../http/types'

export type WorkflowTemplateListItem = {
  id: string
  titleZh: string
  descriptionZh: string
  tags: string[]
  requiredPacks: string[]
  whitelistKeys: string[]
}

export type WorkflowTemplatesListOkData = {
  templates: WorkflowTemplateListItem[]
}

export class WorkflowTemplatesListReq extends HttpRequest {
  get url(): string {
    return '/workflows/templates'
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

export class WorkflowTemplatesListRsp extends HttpPacket {
  ok = false
  message = ''
  data: WorkflowTemplatesListOkData | null = null

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
      this.message = typeof o.message === 'string' ? o.message : '無法取得模板列表'
      return
    }
    const templates: WorkflowTemplateListItem[] = []
    const raw = o.templates
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (row == null || typeof row !== 'object') continue
        const t = row as Record<string, unknown>
        if (typeof t.id !== 'string' || !t.id.trim()) continue
        templates.push({
          id: t.id.trim(),
          titleZh: typeof t.titleZh === 'string' ? t.titleZh : '',
          descriptionZh: typeof t.descriptionZh === 'string' ? t.descriptionZh : '',
          tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string') : [],
          requiredPacks: Array.isArray(t.requiredPacks)
            ? t.requiredPacks.filter((x): x is string => typeof x === 'string')
            : [],
          whitelistKeys: Array.isArray(t.whitelistKeys)
            ? t.whitelistKeys.filter((x): x is string => typeof x === 'string')
            : [],
        })
      }
    }
    this.ok = true
    this.data = { templates }
  }
}
