import type { CheckpointTagAssistantCivitaiModel } from './checkpointTagAssistant'

export type AssistantResourceExtraKind = 'lora' | 'textual_inversion' | 'controlnet' | 'workflow'

export type AssistantResourceExtraOk = {
  kind: AssistantResourceExtraKind
  titleZh: string
  detailZh?: string
  modelTags: string[]
  searchQueries: string[]
  recommendedModels: CheckpointTagAssistantCivitaiModel[]
}

function readStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const el of x) {
    if (typeof el === 'string' && el.trim()) out.push(el.trim())
  }
  return out
}

function parseRecModel(row: unknown): CheckpointTagAssistantCivitaiModel | null {
  if (row == null || typeof row !== 'object') return null
  const o = row as Record<string, unknown>
  if (typeof o.id !== 'number' || typeof o.name !== 'string') return null
  const tags = readStringArray(o.tags)
  const civitaiUrl = typeof o.civitaiUrl === 'string' ? o.civitaiUrl : `https://civitai.com/models/${String(o.id)}`
  const descriptionText = typeof o.descriptionText === 'string' ? o.descriptionText : ''
  return { id: o.id, name: o.name, tags, civitaiUrl, descriptionText }
}

const KINDS = new Set<AssistantResourceExtraKind>(['lora', 'textual_inversion', 'controlnet', 'workflow'])

function normalizeKind(x: unknown): AssistantResourceExtraKind | null {
  if (typeof x !== 'string') return null
  const k = x.trim().toLowerCase() as AssistantResourceExtraKind
  return KINDS.has(k) ? k : null
}

export function parseAssistantResourceExtrasPayload(raw: unknown): AssistantResourceExtraOk[] {
  if (!Array.isArray(raw)) return []
  const out: AssistantResourceExtraOk[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const kind = normalizeKind(o.kind)
    if (!kind) continue
    const titleZh = typeof o.titleZh === 'string' ? o.titleZh.trim() : ''
    if (!titleZh) continue
    const detailZh = typeof o.detailZh === 'string' && o.detailZh.trim() ? o.detailZh.trim() : undefined
    const modelTags = readStringArray(o.modelTags)
    const searchQueries = readStringArray(o.searchQueries)
    const rm = Array.isArray(o.recommendedModels) ? o.recommendedModels : []
    const recommendedModels: CheckpointTagAssistantCivitaiModel[] = []
    for (const m of rm) {
      const p = parseRecModel(m)
      if (p) recommendedModels.push(p)
    }
    out.push({ kind, titleZh, detailZh, modelTags, searchQueries, recommendedModels })
    if (out.length >= 6) break
  }
  return out
}
