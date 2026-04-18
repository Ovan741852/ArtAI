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
import { removeBackgroundWithRemoveBg } from './mattingRemoveBg.js'
import { buildMattingExecutionPlan, type MattingPlanStep } from './mattingPickPlan.js'

export type MattingAutoBody = {
  imageBase64: string
  /** 覆寫讀圖分類用 Ollama 模型（須支援視覺較佳）；省略則用 `OLLAMA_SUMMARY_MODEL`。 */
  ollamaModel?: string
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
}

function stepLabel(step: MattingPlanStep): string {
  if (step.kind === 'comfy') return `comfy:${step.comfyClassType ?? ''}`
  return step.kind
}

export async function runMattingAuto(env: ServerEnv, body: unknown): Promise<MattingAutoResult> {
  if (body == null || typeof body !== 'object') {
    throw new AppHttpError(400, 'Request body must be a JSON object')
  }
  const b = body as MattingAutoBody
  const decoded = decodeMattingImageBase64(b.imageBase64)
  const imageB64ForVision = decoded.buffer.toString('base64')

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
    removeBg: Boolean(env.removeBgApiKey?.trim()),
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
        return {
          classification: cls.classification,
          chosenExecutor: 'comfy',
          chosenReasonZh: step.reasonZh,
          triedExecutors: tried,
          comfyNodeType: step.comfyClassType,
          ollamaModelUsed: cls.modelUsed,
          visionClassificationUsed: cls.usedVision,
          imagePngBase64: buf.toString('base64'),
          warnings,
        }
      }

      if (step.kind === 'remove_bg' && env.removeBgApiKey?.trim()) {
        const buf = await removeBackgroundWithRemoveBg({
          apiKey: env.removeBgApiKey.trim(),
          imageBytes: decoded.buffer,
          mime: decoded.mime,
        })
        return {
          classification: cls.classification,
          chosenExecutor: 'remove_bg',
          chosenReasonZh: step.reasonZh,
          triedExecutors: tried,
          comfyNodeType: null,
          ollamaModelUsed: cls.modelUsed,
          visionClassificationUsed: cls.usedVision,
          imagePngBase64: buf.toString('base64'),
          warnings,
        }
      }

      if (step.kind === 'local_onnx') {
        const buf = await removeBackgroundWithImgly(decoded)
        return {
          classification: cls.classification,
          chosenExecutor: 'local_onnx',
          chosenReasonZh: step.reasonZh,
          triedExecutors: tried,
          comfyNodeType: null,
          ollamaModelUsed: cls.modelUsed,
          visionClassificationUsed: cls.usedVision,
          imagePngBase64: buf.toString('base64'),
          warnings,
        }
      }
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e)
      attemptErrors.push({ step: stepLabel(step), error: lastMessage })
      warnings.push(`${stepLabel(step)} 失敗：${lastMessage}`)
    }
  }

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
