import { HttpPacket, HttpRequest } from '../http/types'

export type CharacterTxt2ImgPatchApply = {
  ok: true
  appliedKeys: string[]
  ignoredKeys: string[]
}

export type CharacterTxt2ImgOkData = {
  imagePngBase64: string
  positiveFinalEn: string
  negativeUsed: string
  checkpointUsed: string
  checkpointDecisionZh: string
  ollamaExpansionUsed: boolean
  feedbackApplied: boolean
  messageZh: string
  patchApply: CharacterTxt2ImgPatchApply
}

export class CharacterTxt2ImgReq extends HttpRequest {
  private characterId = ''
  private payload: Record<string, unknown> = {}

  onAllocate(characterId: string, payload: Record<string, unknown>): void {
    this.characterId = characterId.trim()
    this.payload = payload
  }

  get url(): string {
    return `/characters/${encodeURIComponent(this.characterId)}/generations/txt2img`
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

export class CharacterTxt2ImgRsp extends HttpPacket {
  ok = false
  message = ''
  data: CharacterTxt2ImgOkData | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    if (payload == null || typeof payload !== 'object') return
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.message = typeof o.message === 'string' ? o.message : '生成失敗'
      return
    }
    const img = o.imagePngBase64
    const pos = o.positiveFinalEn
    if (typeof img !== 'string' || img.length === 0 || typeof pos !== 'string') return
    const pa = o.patchApply
    let patchApply: CharacterTxt2ImgPatchApply = { ok: true, appliedKeys: [], ignoredKeys: [] }
    if (pa != null && typeof pa === 'object') {
      const p = pa as Record<string, unknown>
      if (p.ok === true && Array.isArray(p.appliedKeys) && Array.isArray(p.ignoredKeys)) {
        patchApply = {
          ok: true,
          appliedKeys: p.appliedKeys.filter((x): x is string => typeof x === 'string'),
          ignoredKeys: p.ignoredKeys.filter((x): x is string => typeof x === 'string'),
        }
      }
    }
    this.ok = true
    this.data = {
      imagePngBase64: img,
      positiveFinalEn: pos,
      negativeUsed: typeof o.negativeUsed === 'string' ? o.negativeUsed : '',
      checkpointUsed: typeof o.checkpointUsed === 'string' ? o.checkpointUsed : '',
      checkpointDecisionZh: typeof o.checkpointDecisionZh === 'string' ? o.checkpointDecisionZh : '',
      ollamaExpansionUsed: o.ollamaExpansionUsed === true,
      feedbackApplied: o.feedbackApplied === true,
      messageZh: typeof o.messageZh === 'string' ? o.messageZh : '',
      patchApply,
    }
  }
}
