import type { MattingClassification } from './mattingClassify.js'
import type { MattingComfyCandidate } from './mattingComfyCaps.js'

export type MattingExecutorKind = 'comfy' | 'remove_bg' | 'local_onnx'

export type MattingPlanStep = {
  kind: MattingExecutorKind
  /** Comfy `class_type` when kind is comfy */
  comfyClassType?: string
  score: number
  reasonZh: string
}

export type MattingCapabilities = {
  comfyCandidates: MattingComfyCandidate[]
  removeBg: boolean
  localOnnx: boolean
}

function humanLike(c: MattingClassification): boolean {
  return c.primarySubject === 'single_human_portrait' || c.primarySubject === 'multiple_humans'
}

function hardEdges(c: MattingClassification): boolean {
  return c.edgeDifficulty === 'hard'
}

/**
 * 依讀圖分類與當下可用後端，排出嘗試順序（分數高者在前）；最後一律保留本機 ONNX 作為後備。
 */
export function buildMattingExecutionPlan(
  classification: MattingClassification,
  caps: MattingCapabilities,
): MattingPlanStep[] {
  const steps: MattingPlanStep[] = []
  const comfyFine = caps.comfyCandidates.find((x) => x.tier === 'fine')
  const comfyGeneral = caps.comfyCandidates.find((x) => x.tier === 'general')

  const pushComfy = (cand: MattingComfyCandidate, score: number, reasonZh: string) => {
    steps.push({ kind: 'comfy', comfyClassType: cand.classType, score, reasonZh })
  }

  if (humanLike(classification) && hardEdges(classification) && comfyFine) {
    pushComfy(
      comfyFine,
      100,
      '畫面以人像為主且邊緣細節要求高，優先使用 Comfy 較精細之摳圖節點（若已安裝）。',
    )
  }

  if (caps.removeBg && humanLike(classification) && (hardEdges(classification) || classification.preferQualityOverSpeed)) {
    steps.push({
      kind: 'remove_bg',
      score: 88,
      reasonZh: '人像且重視邊緣品質，使用 Remove.bg 雲端服務（已設定金鑰）。',
    })
  }

  if (comfyGeneral) {
    pushComfy(
      comfyGeneral,
      72,
      '偵測到 Comfy 一般去背／分割節點，適合多數主體與場景。',
    )
  }

  if (comfyFine && !steps.some((s) => s.kind === 'comfy' && s.comfyClassType === comfyFine.classType)) {
    pushComfy(comfyFine, 65, '使用 Comfy 精細摳圖節點處理此圖。')
  }

  if (caps.removeBg && !steps.some((s) => s.kind === 'remove_bg')) {
    steps.push({
      kind: 'remove_bg',
      score: 55,
      reasonZh: '已設定 Remove.bg，可作為高品質去背選項。',
    })
  }

  if (caps.localOnnx) {
    steps.push({
      kind: 'local_onnx',
      score: 25,
      reasonZh: '使用本機 ONNX 模型去背（無需 Comfy 自訂節點）。',
    })
  }

  steps.sort((a, b) => b.score - a.score)

  const dedup: MattingPlanStep[] = []
  const seen = new Set<string>()
  for (const s of steps) {
    const key = s.kind === 'comfy' ? `comfy:${s.comfyClassType ?? ''}` : s.kind
    if (seen.has(key)) continue
    seen.add(key)
    dedup.push(s)
  }

  if (!dedup.some((s) => s.kind === 'local_onnx') && caps.localOnnx) {
    dedup.push({
      kind: 'local_onnx',
      score: 10,
      reasonZh: '本機 ONNX 後備方案。',
    })
  }

  return dedup
}
