import { HttpPacket, HttpRequest } from '../http/types'

export type WorkflowTemplateRunPatchApply = {
  ok: true
  appliedKeys: string[]
  ignoredKeys: string[]
}

export type WorkflowTemplateRunOkData = {
  imagePngBase64: string
  patchApply: WorkflowTemplateRunPatchApply
}

export class WorkflowTemplateRunReq extends HttpRequest {
  private templateId = ''
  private payload: Record<string, unknown> = {}

  onAllocate(
    templateId: string,
    patch?: Record<string, unknown>,
    timeoutMs?: number,
    referenceImagePngBase64?: string | null,
  ): void {
    this.templateId = templateId.trim()
    this.payload = {
      patch: patch ?? {},
      ...(timeoutMs != null ? { timeoutMs } : {}),
      ...(referenceImagePngBase64?.trim() ? { referenceImagePngBase64: referenceImagePngBase64.trim() } : {}),
    }
  }

  get url(): string {
    return `/workflows/templates/${encodeURIComponent(this.templateId)}/run`
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

export class WorkflowTemplateRunRsp extends HttpPacket {
  ok = false
  message = ''
  data: WorkflowTemplateRunOkData | null = null

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
      this.message = typeof o.message === 'string' ? o.message : '生圖失敗'
      return
    }
    const b64 = typeof o.imagePngBase64 === 'string' ? o.imagePngBase64 : ''
    if (!b64.trim()) {
      this.message = '回應缺少圖片'
      return
    }
    const pa = o.patchApply
    if (pa == null || typeof pa !== 'object' || (pa as Record<string, unknown>).ok !== true) {
      this.message = '回應缺少 patchApply'
      return
    }
    const p = pa as Record<string, unknown>
    this.ok = true
    this.data = {
      imagePngBase64: b64.trim(),
      patchApply: {
        ok: true,
        appliedKeys: readStringArray(p.appliedKeys),
        ignoredKeys: readStringArray(p.ignoredKeys),
      },
    }
  }
}
