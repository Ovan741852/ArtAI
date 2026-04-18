import { HttpPacket, HttpRequest } from '../http/types'

export type MattingClassification = {
  primarySubject: string
  edgeDifficulty: string
  preferQualityOverSpeed: boolean
}

export type MattingAutoOkData = {
  classification: MattingClassification
  chosenExecutor: 'comfy' | 'remove_bg' | 'local_onnx'
  chosenReasonZh: string
  triedExecutors: string[]
  comfyNodeType: string | null
  ollamaModelUsed: string
  visionClassificationUsed: boolean
  imagePngBase64: string
  warnings: string[]
}

export class MattingAutoReq extends HttpRequest {
  private imageBase64 = ''
  private ollamaModel: string | undefined

  onAllocate(imageBase64: string, ollamaModel?: string): void {
    this.imageBase64 = imageBase64
    this.ollamaModel = ollamaModel?.trim() || undefined
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
      if (
        classification != null &&
        typeof classification === 'object' &&
        typeof chosenExecutor === 'string' &&
        typeof chosenReasonZh === 'string' &&
        Array.isArray(triedExecutors) &&
        typeof imagePngBase64 === 'string' &&
        imagePngBase64.length > 0
      ) {
        const cls = classification as Record<string, unknown>
        const primarySubject = typeof cls.primarySubject === 'string' ? cls.primarySubject : ''
        const edgeDifficulty = typeof cls.edgeDifficulty === 'string' ? cls.edgeDifficulty : ''
        const preferQualityOverSpeed = typeof cls.preferQualityOverSpeed === 'boolean' ? cls.preferQualityOverSpeed : false
        this.ok = true
        this.data = {
          classification: { primarySubject, edgeDifficulty, preferQualityOverSpeed },
          chosenExecutor: chosenExecutor as MattingAutoOkData['chosenExecutor'],
          chosenReasonZh,
          triedExecutors: triedExecutors.filter((x): x is string => typeof x === 'string'),
          comfyNodeType: typeof o.comfyNodeType === 'string' || o.comfyNodeType === null ? (o.comfyNodeType as string | null) : null,
          ollamaModelUsed: typeof o.ollamaModelUsed === 'string' ? o.ollamaModelUsed : '',
          visionClassificationUsed: Boolean(o.visionClassificationUsed),
          imagePngBase64,
          warnings: Array.isArray(o.warnings) ? o.warnings.filter((x): x is string => typeof x === 'string') : [],
        }
      }
      return
    }
    if (o.ok === false && typeof o.message === 'string') {
      this.message = o.message
    }
  }
}
