import { HttpPacket, HttpRequest } from '../http/types'
import {
  CREATIVE_LOOP_ASSISTANT_REPLY_FALLBACK_ZH,
  resolveAssistantReplyZhFromAssistantPayload,
} from './assistantUserReplyLine'

export type CreativeLoopChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type CreativeLoopPatchApply =
  | { ok: true; appliedKeys: string[]; ignoredKeys: string[] }
  | { ok: false; message: string }

export type CreativeLoopChatOkData = {
  ollamaModel: string
  selectedTemplateId: string
  runMode: 'txt2img' | 'img2img'
  templateRouteZh: string
  warnings: string[]
  templateTitleZh: string
  localCheckpoints: string[]
  attachedImageCount: number
  assistant: {
    replyZh: string
    understandingZh?: string
    proposedPatch: Record<string, unknown>
  }
  patchApply: CreativeLoopPatchApply | null
}

export class CreativeLoopChatReq extends HttpRequest {
  private payload: Record<string, unknown> = { messages: [] }

  onAllocate(
    messages: CreativeLoopChatMessage[],
    opts?: {
      /** 進階覆寫；省略則由伺服器依是否有參考圖自動選模板。 */
      selectedTemplateId?: string | null
      ollamaModel?: string
      imageBase64?: string | null
      imageBase64s?: string[] | null
      lastOutputPngBase64?: string | null
    },
  ): void {
    const imgs = opts?.imageBase64s?.map((s) => s.trim()).filter((s) => s.length > 0) ?? []
    const single = opts?.imageBase64?.trim()
    const tid = opts?.selectedTemplateId?.trim()
    this.payload = {
      messages,
      ...(tid ? { selectedTemplateId: tid } : {}),
      ...(opts?.ollamaModel ? { ollamaModel: opts.ollamaModel } : {}),
      ...(single ? { imageBase64: single } : {}),
      ...(imgs.length > 0 ? { imageBase64s: imgs } : {}),
      ...(opts?.lastOutputPngBase64?.trim() ? { lastOutputPngBase64: opts.lastOutputPngBase64.trim() } : {}),
    }
  }

  get url(): string {
    return '/images/creative-loop/chat'
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

export class CreativeLoopChatRsp extends HttpPacket {
  ok = false
  message = ''
  data: CreativeLoopChatOkData | null = null

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
      this.message = typeof o.message === 'string' ? o.message : '請求失敗'
      return
    }
    const assistant = o.assistant
    if (assistant == null || typeof assistant !== 'object') {
      this.message = '回應缺少 assistant'
      return
    }
    const as = assistant as Record<string, unknown>
    const replyZh = resolveAssistantReplyZhFromAssistantPayload(as, CREATIVE_LOOP_ASSISTANT_REPLY_FALLBACK_ZH)
    const proposedPatch =
      as.proposedPatch != null && typeof as.proposedPatch === 'object' && !Array.isArray(as.proposedPatch)
        ? { ...(as.proposedPatch as Record<string, unknown>) }
        : {}

    let patchApply: CreativeLoopPatchApply | null = null
    const pa = o.patchApply
    if (pa != null && typeof pa === 'object' && !Array.isArray(pa)) {
      const p = pa as Record<string, unknown>
      if (p.ok === true) {
        patchApply = {
          ok: true,
          appliedKeys: readStringArray(p.appliedKeys),
          ignoredKeys: readStringArray(p.ignoredKeys),
        }
      } else if (p.ok === false && typeof p.message === 'string') {
        patchApply = { ok: false, message: p.message }
      }
    }

    const warnings = Array.isArray(o.warnings)
      ? o.warnings.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim())
      : []
    const runMode = o.runMode === 'img2img' ? 'img2img' : 'txt2img'

    this.ok = true
    this.data = {
      ollamaModel: typeof o.ollamaModel === 'string' ? o.ollamaModel : '',
      selectedTemplateId: typeof o.selectedTemplateId === 'string' ? o.selectedTemplateId : '',
      runMode,
      templateRouteZh: typeof o.templateRouteZh === 'string' ? o.templateRouteZh : '',
      warnings,
      templateTitleZh: typeof o.templateTitleZh === 'string' ? o.templateTitleZh : '',
      localCheckpoints: readStringArray(o.localCheckpoints),
      attachedImageCount: typeof o.attachedImageCount === 'number' ? o.attachedImageCount : 0,
      assistant: {
        replyZh,
        understandingZh: typeof as.understandingZh === 'string' ? as.understandingZh : undefined,
        proposedPatch,
      },
      patchApply,
    }
  }
}
