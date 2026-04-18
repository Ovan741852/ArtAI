import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { getComfyObjectInfoCached } from './comfyuiObjectInfo.js'
import {
  canWireSimpleImageMatting,
  listMattingComfyCandidates,
} from './mattingComfyCaps.js'
import { classifyMattingImage, type MattingClassification } from './mattingClassify.js'
import { decodeMattingImageBase64 } from './mattingImageBytes.js'
import { removeBackgroundViaComfy } from './mattingComfyRun.js'
import { removeBackgroundWithImgly } from './mattingLocalImgly.js'
import { buildMattingExecutionPlan, type MattingPlanStep } from './mattingPickPlan.js'
import {
  anyMattingEnhancement,
  applyMattingEnhancements,
  parseMattingEnhancements,
  type MattingEnhancements,
} from './mattingEnhancements.js'

export type MattingAutoBody = {
  imageBase64: string
  /** 覆寫讀圖分類用 Ollama 模型（須支援視覺較佳）；省略則用 `OLLAMA_SUMMARY_MODEL`。 */
  ollamaModel?: string
  /** 強化：`edgeRefine: true` 時第一輪成功後再跑本機 ONNX 第二輪。 */
  enhancements?: MattingEnhancements
}

export type MattingAutoResult = {
  classification: MattingClassification
  chosenExecutor: MattingPlanStep['kind']
  chosenReasonZh: string
  triedExecutors: string[]
  comfyNodeType: string | null
  ollamaModelUsed: string
  visionClassificationUsed: boolean
  /** PNG，不含 data URL 前綴 */
  imagePngBase64: string
  warnings: string[]
  /** 本次請求是否套用強化第二輪 */
  enhancementSecondPassUsed: boolean
  /** 已執行之強化步驟（繁中），無則空陣列 */
  enhancementAppliedStepsZh: string[]
  /** 請求帶入之強化勾選 */
  enhancementsRequested: { edgeRefine: boolean }
}

function stepLabel(step: MattingPlanStep): string {
  if (step.kind === 'comfy') return `comfy:${step.comfyClassType ?? ''}`
  return step.kind
}

type FirstRoundOk = {
  buf: Buffer
  chosenExecutor: MattingPlanStep['kind']
  chosenReasonZh: string
  comfyNodeType: string | null
}

export async function runMattingAuto(env: ServerEnv, body: unknown): Promise<MattingAutoResult> {
  if (body == null || typeof body !== 'object') {
    throw new AppHttpError(400, 'Request body must be a JSON object')
  }
  const b = body as MattingAutoBody
  const decoded = decodeMattingImageBase64(b.imageBase64)
  const imageB64ForVision = decoded.buffer.toString('base64')
  const enhancements = parseMattingEnhancements(b.enhancements)
  const enhancementsRequested = {
    edgeRefine: enhancements.edgeRefine === true,
  }

  let objectInfo: unknown | null = null
  try {
    const hit = await getComfyObjectInfoCached(env.comfyuiBaseUrl, env.comfyObjectInfoTtlMs, { force: false })
    objectInfo = hit.objectInfo
  } catch {
    objectInfo = null
  }

  const allComfy = listMattingComfyCandidates(objectInfo)
  const comfyCandidates =
    objectInfo != null && typeof objectInfo === 'object'
      ? allComfy.filter((c) => canWireSimpleImageMatting((objectInfo as Record<string, unknown>)[c.classType]))
      : []

  const caps = {
    comfyCandidates,
    localOnnx: true,
  }

  const cls = await classifyMattingImage({
    env,
    imageBase64NoPrefix: imageB64ForVision,
    ollamaModel: b.ollamaModel,
  })

  const warnings: string[] = []
  if (cls.noteEn) warnings.push(cls.noteEn)

  const plan = buildMattingExecutionPlan(cls.classification, caps)
  if (plan.length === 0) {
    throw new AppHttpError(500, 'No matting backend is available')
  }

  const tried: string[] = []
  let lastMessage = ''
  const attemptErrors: { step: string; error: string }[] = []

  let first: FirstRoundOk | null = null

  for (const step of plan) {
    tried.push(stepLabel(step))
    try {
      if (step.kind === 'comfy' && step.comfyClassType && objectInfo != null) {
        const buf = await removeBackgroundViaComfy({
          comfyuiBaseUrl: env.comfyuiBaseUrl,
          objectInfo,
          mattingClassType: step.comfyClassType,
          image: decoded,
          classification: cls.classification,
        })
        first = {
          buf,
          chosenExecutor: 'comfy',
          chosenReasonZh: step.reasonZh,
          comfyNodeType: step.comfyClassType,
        }
        break
      }

      if (step.kind === 'local_onnx') {
        const buf = await removeBackgroundWithImgly(decoded)
        first = {
          buf,
          chosenExecutor: 'local_onnx',
          chosenReasonZh: step.reasonZh,
          comfyNodeType: null,
        }
        break
      }
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e)
      attemptErrors.push({ step: stepLabel(step), error: lastMessage })
      warnings.push(`${stepLabel(step)} 失敗：${lastMessage}`)
    }
  }

  if (!first) {
    throw new AppHttpError(
      502,
      lastMessage ? `所有摳圖後端皆失敗（最後錯誤：${lastMessage}）` : '所有摳圖後端皆失敗',
      {
        warnings,
        attemptErrors,
        triedExecutors: tried,
      },
    )
  }

  let outBuf = first.buf
  let enhancementAppliedStepsZh: string[] = []
  let enhancementSecondPassUsed = false

  if (anyMattingEnhancement(enhancements)) {
    try {
      const r = await applyMattingEnhancements({
        round1Png: first.buf,
        enhancements,
      })
      outBuf = r.buffer
      enhancementAppliedStepsZh = r.appliedStepsZh
      enhancementSecondPassUsed = enhancementAppliedStepsZh.length > 0
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new AppHttpError(502, `強化第二輪失敗：${msg}`, {
        warnings: [...warnings, `強化第二輪失敗：${msg}`],
        triedExecutors: tried,
      })
    }
  }

  return {
    classification: cls.classification,
    chosenExecutor: first.chosenExecutor,
    chosenReasonZh: first.chosenReasonZh,
    triedExecutors: tried,
    comfyNodeType: first.comfyNodeType,
    ollamaModelUsed: cls.modelUsed,
    visionClassificationUsed: cls.usedVision,
    imagePngBase64: outBuf.toString('base64'),
    warnings,
    enhancementSecondPassUsed,
    enhancementAppliedStepsZh,
    enhancementsRequested,
  }
}
