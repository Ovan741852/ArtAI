import type { CivitaiModelRow } from './civitaiModelRowMap.js'

/** 與 Civitai `types` 或純說明列對齊。 */
export type AssistantResourceExtraKind = 'lora' | 'textual_inversion' | 'controlnet' | 'workflow'

export type AssistantResourceExtraSpec = {
  kind: AssistantResourceExtraKind
  titleZh: string
  detailZh?: string
  modelTags: string[]
  searchQueries: string[]
}

export type AssistantResourceExtraResolved = AssistantResourceExtraSpec & {
  recommendedModels: CivitaiModelRow[]
}

export function normalizeAssistantResourceExtraKind(raw: unknown): AssistantResourceExtraKind | null {
  if (typeof raw !== 'string') return null
  const k = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (k === 'lora' || k === 'loras') return 'lora'
  if (
    k === 'textual_inversion' ||
    k === 'embedding' ||
    k === 'embeddings' ||
    k === 'ti' ||
    k === 'textualinversion'
  ) {
    return 'textual_inversion'
  }
  if (k === 'controlnet' || k === 'control_net') return 'controlnet'
  if (k === 'workflow' || k === 'workflow_tip' || k === 'tip') return 'workflow'
  return null
}
