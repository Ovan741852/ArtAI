import { HttpPacket, HttpRequest } from '../http/types'

export type MattingClassification = {
  primarySubject: string
  edgeDifficulty: string
  preferQualityOverSpeed: boolean
}

export type MattingEnhancementsRequest = {
  edgeRefine?: boolean
}

export type MattingAutoOkData = {
  classification: MattingClassification
  chosenExecutor: 'comfy' | 'local_onnx'
  chosenReasonZh: string
  triedExecutors: string[]
  comfyNodeType: string | null
  ollamaModelUsed: string
  visionClassificationUsed: boolean
  imagePngBase64: string
  warnings: string[]
  enhancementSecondPassUsed: boolean
  enhancementAppliedStepsZh: string[]
  enhancementsRequested: { edgeRefine: boolean }
}

export class MattingAutoReq extends HttpRequest {
  private imageBase64 = ''
  private ollamaModel: string | undefined
  private enhancements: MattingEnhancementsRequest | undefined

  onAllocate(imageBase64: string, ollamaModel?: string, enhancements?: MattingEnhancementsRequest): void {
    this.imageBase64 = imageBase64
    this.ollamaModel = ollamaModel?.trim() || undefined
    this.enhancements = enhancements
  }

  get url(): string {
    return '/images/matting/auto'
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
    const o: Record<string, unknown> = { imageBase64: this.imageBase64 }
    if (this.ollamaModel) o.ollamaModel = this.ollamaModel
    if (this.enhancements?.edgeRefine === true) {
      o.enhancements = { edgeRefine: true }
    }
    return JSON.stringify(o)
  }
}

export class MattingAutoRsp extends HttpPacket {
  ok = false
  message = ''
  data: MattingAutoOkData | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    if (payload == null || typeof payload !== 'object') return
    const o = payload as Record<string, unknown>
    if (o.ok === true) {
      const classification = o.classification
      const chosenExecutor = o.chosenExecutor
      const chosenReasonZh = o.chosenReasonZh
      const triedExecutors = o.triedExecutors
      const imagePngBase64 = o.imagePngBase64
      const executorOk = chosenExecutor === 'comfy' || chosenExecutor === 'local_onnx'
      if (
        executorOk &&
        classification != null &&
        typeof classification === 'object' &&
        typeof chosenReasonZh === 'string' &&
        Array.isArray(triedExecutors) &&
        typeof imagePngBase64 === 'string' &&
        imagePngBase64.length > 0
      ) {
        const cls = classification as Record<string, unknown>
        const primarySubject = typeof cls.primarySubject === 'string' ? cls.primarySubject : ''
        const edgeDifficulty = typeof cls.edgeDifficulty === 'string' ? cls.edgeDifficulty : ''
        const preferQualityOverSpeed = typeof cls.preferQualityOverSpeed === 'boolean' ? cls.preferQualityOverSpeed : false

        const enhancementSecondPassUsed = o.enhancementSecondPassUsed === true
        const enhancementAppliedStepsZh = Array.isArray(o.enhancementAppliedStepsZh)
          ? o.enhancementAppliedStepsZh.filter((x): x is string => typeof x === 'string')
          : []
        const er = o.enhancementsRequested
        let enhancementsRequested = { edgeRefine: false }
        if (er != null && typeof er === 'object') {
          const r = er as Record<string, unknown>
          enhancementsRequested = {
            edgeRefine: r.edgeRefine === true,
          }
        }

        this.ok = true
        this.data = {
          classification: { primarySubject, edgeDifficulty, preferQualityOverSpeed },
          chosenExecutor,
          chosenReasonZh,
          triedExecutors: triedExecutors.filter((x): x is string => typeof x === 'string'),
          comfyNodeType: typeof o.comfyNodeType === 'string' || o.comfyNodeType === null ? (o.comfyNodeType as string | null) : null,
          ollamaModelUsed: typeof o.ollamaModelUsed === 'string' ? o.ollamaModelUsed : '',
          visionClassificationUsed: Boolean(o.visionClassificationUsed),
          imagePngBase64,
          warnings: Array.isArray(o.warnings) ? o.warnings.filter((x): x is string => typeof x === 'string') : [],
          enhancementSecondPassUsed,
          enhancementAppliedStepsZh,
          enhancementsRequested,
        }
      }
      return
    }
    if (o.ok === false && typeof o.message === 'string') {
      this.message = o.message
    }
  }
}
