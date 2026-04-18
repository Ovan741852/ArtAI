import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import type { ServerEnv } from '../config/env.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'

export type MattingPrimarySubject =
  | 'single_human_portrait'
  | 'multiple_humans'
  | 'product_object'
  | 'scene_mixed'

export type MattingEdgeDifficulty = 'simple' | 'moderate' | 'hard'

export type MattingClassification = {
  primarySubject: MattingPrimarySubject
  edgeDifficulty: MattingEdgeDifficulty
  preferQualityOverSpeed: boolean
}

const DEFAULT_CLASSIFICATION: MattingClassification = {
  primarySubject: 'single_human_portrait',
  edgeDifficulty: 'moderate',
  preferQualityOverSpeed: true,
}

function coerceClassification(raw: unknown): MattingClassification {
  if (raw == null || typeof raw !== 'object') return DEFAULT_CLASSIFICATION
  const o = raw as Record<string, unknown>

  const ps = o.primarySubject
  const primarySubject: MattingPrimarySubject =
    ps === 'single_human_portrait' ||
    ps === 'multiple_humans' ||
    ps === 'product_object' ||
    ps === 'scene_mixed'
      ? ps
      : DEFAULT_CLASSIFICATION.primarySubject

  const ed = o.edgeDifficulty
  const edgeDifficulty: MattingEdgeDifficulty =
    ed === 'simple' || ed === 'moderate' || ed === 'hard' ? ed : DEFAULT_CLASSIFICATION.edgeDifficulty

  const pq = o.preferQualityOverSpeed
  const preferQualityOverSpeed = typeof pq === 'boolean' ? pq : DEFAULT_CLASSIFICATION.preferQualityOverSpeed

  return { primarySubject, edgeDifficulty, preferQualityOverSpeed }
}

/**
 * 以 Ollama 視覺模型讀圖，回傳結構化分類（失敗時回預設值，不拋錯）。
 */
export async function classifyMattingImage(params: {
  env: ServerEnv
  imageBase64NoPrefix: string
  ollamaModel?: string
}): Promise<{ classification: MattingClassification; modelUsed: string; usedVision: boolean; noteEn?: string }> {
  const model = params.ollamaModel?.trim() || params.env.ollamaSummaryModel
  const prompt = [
    'You route an image to a background-removal backend.',
    'Return ONE JSON object only. No markdown, no commentary.',
    'Keys exactly: "primarySubject", "edgeDifficulty", "preferQualityOverSpeed".',
    '',
    '"primarySubject" must be one of:',
    '- "single_human_portrait" (one clear human face/body as main subject)',
    '- "multiple_humans"',
    '- "product_object" (packshot, item, food, vehicle without humans as focus)',
    '- "scene_mixed" (crowd, complex scene, architecture, busy background)',
    '',
    '"edgeDifficulty" must be one of:',
    '- "simple" (clean edges, solid background, simple silhouette)',
    '- "moderate"',
    '- "hard" (fine hair, fur, netting, glass, motion blur, busy similar-color background)',
    '',
    '"preferQualityOverSpeed" boolean: true if hair/detail edges matter; false if a fast cutout is enough.',
  ].join('\n')

  try {
    const raw = await ollamaGenerateNonStream({
      ollamaBaseUrl: params.env.ollamaBaseUrl,
      model,
      prompt,
      images: [params.imageBase64NoPrefix],
    })
    const parsed = parseJsonObjectFromLlm(raw)
    return {
      classification: coerceClassification(parsed),
      modelUsed: model,
      usedVision: true,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      classification: DEFAULT_CLASSIFICATION,
      modelUsed: model,
      usedVision: false,
      noteEn: `Vision classification skipped or failed; using defaults. (${msg})`,
    }
  }
}
