import type { CheckpointTagAssistantCivitaiModel } from './checkpointTagAssistant'
import { parseAssistantResourceExtrasPayload, type AssistantResourceExtraOk } from './assistantResourceExtras'
export type { AssistantResourceExtraOk } from './assistantResourceExtras'

export type ModelBundleAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

/** 與 checkpoint 助手推薦列相同精簡形狀，供卡片顯示。 */
export type ModelBundleAssistantCivitaiModel = CheckpointTagAssistantCivitaiModel

export type ModelBundleAssistantSlotOk = {
  modelTags: string[]
  searchQueries: string[]
  recommendedModels: ModelBundleAssistantCivitaiModel[]
}

export type ModelBundleAssistantBundleOk = {
  titleZh: string
  noteZh?: string
  checkpoint: ModelBundleAssistantSlotOk
  loras: ModelBundleAssistantSlotOk[]
}

export type ModelBundleAssistantOkData = {
  ollamaModel: string
  imageAttached: boolean
  attachedImageCount: number
  assistant: {
    replyZh: string
  }
  bundles: ModelBundleAssistantBundleOk[]
  resourceExtras: AssistantResourceExtraOk[]
}

function readStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const el of x) {
    if (typeof el === 'string' && el.trim()) out.push(el.trim())
  }
  return out
}

function parseRecommendedModel(row: unknown): ModelBundleAssistantCivitaiModel | null {
  if (row == null || typeof row !== 'object') return null
  const o = row as Record<string, unknown>
  if (typeof o.id !== 'number' || typeof o.name !== 'string') return null
  const tags = readStringArray(o.tags)
  const civitaiUrl = typeof o.civitaiUrl === 'string' ? o.civitaiUrl : `https://civitai.com/models/${String(o.id)}`
  const descriptionText = typeof o.descriptionText === 'string' ? o.descriptionText : ''
  return { id: o.id, name: o.name, tags, civitaiUrl, descriptionText }
}

function parseRecommended(raw: unknown): ModelBundleAssistantCivitaiModel[] {
  if (!Array.isArray(raw)) return []
  const out: ModelBundleAssistantCivitaiModel[] = []
  for (const row of raw) {
    const m = parseRecommendedModel(row)
    if (m) out.push(m)
  }
  return out
}

function parseSlot(raw: unknown): ModelBundleAssistantSlotOk | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    modelTags: readStringArray(o.modelTags),
    searchQueries: readStringArray(o.searchQueries),
    recommendedModels: parseRecommended(o.recommendedModels),
  }
}

function parseBundle(raw: unknown): ModelBundleAssistantBundleOk | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.titleZh !== 'string' || !o.titleZh.trim()) return null
  const checkpoint = parseSlot(o.checkpoint)
  if (!checkpoint) return null
  const noteZh = typeof o.noteZh === 'string' && o.noteZh.trim() ? o.noteZh.trim() : undefined
  const lorasRaw = o.loras
  const loras: ModelBundleAssistantSlotOk[] = []
  if (Array.isArray(lorasRaw)) {
    for (const el of lorasRaw) {
      const s = parseSlot(el)
      if (s) loras.push(s)
    }
  }
  return { titleZh: o.titleZh.trim(), noteZh, checkpoint, loras }
}

export function parseModelBundleAssistantFinalPayload(o: Record<string, unknown>): ModelBundleAssistantOkData | null {
  if (o.ok !== true) return null
  const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : ''
  const imageAttached = o.imageAttached === true
  const attachedRaw = o.attachedImageCount
  const attachedImageCount =
    typeof attachedRaw === 'number' && Number.isFinite(attachedRaw)
      ? Math.max(0, Math.floor(attachedRaw))
      : imageAttached
        ? 1
        : 0
  const assistantRaw = o.assistant
  if (!assistantRaw || typeof assistantRaw !== 'object') return null
  const a = assistantRaw as Record<string, unknown>
  const replyZh = typeof a.replyZh === 'string' ? a.replyZh : ''
  const bundlesRaw = o.bundles
  if (!Array.isArray(bundlesRaw) || bundlesRaw.length === 0) return null
  const bundles: ModelBundleAssistantBundleOk[] = []
  for (const row of bundlesRaw) {
    const b = parseBundle(row)
    if (b) bundles.push(b)
  }
  if (bundles.length === 0) return null

  const resourceExtras = parseAssistantResourceExtrasPayload(o.resourceExtras)

  return {
    ollamaModel,
    imageAttached,
    attachedImageCount,
    assistant: { replyZh },
    bundles,
    resourceExtras,
  }
}
