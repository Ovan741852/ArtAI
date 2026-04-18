import type { ServerEnv } from '../config/env.js'
import { coerceLlmStringList } from '../lib/coerceLlmStringList.js'
import type { CivitaiModelRow } from './civitaiModelRowMap.js'
import { mergeHotCivitaiModelsByTagsAndQueries } from './civitaiSuggestModelsFromDescriptions.js'
import {
  type AssistantResourceExtraKind,
  type AssistantResourceExtraResolved,
  type AssistantResourceExtraSpec,
  normalizeAssistantResourceExtraKind,
} from './assistantResourceExtrasTypes.js'

const MAX_EXTRAS = 6
const MAX_TAGS = 4
const MAX_QUERIES = 2

export function parseAssistantResourceExtrasFromLlm(o: Record<string, unknown>): AssistantResourceExtraSpec[] {
  const raw = o.resourceExtras
  if (raw == null) return []
  if (!Array.isArray(raw)) return []
  const out: AssistantResourceExtraSpec[] = []
  for (let i = 0; i < raw.length && out.length < MAX_EXTRAS; i++) {
    const row = raw[i]
    if (row == null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const kind = normalizeAssistantResourceExtraKind(r.kind)
    if (!kind) continue
    const titleZh = typeof r.titleZh === 'string' ? r.titleZh.trim() : ''
    if (!titleZh) continue
    const detailZh = typeof r.detailZh === 'string' && r.detailZh.trim() ? r.detailZh.trim() : undefined
    const modelTags = coerceLlmStringList(r.modelTags, MAX_TAGS)
    const searchQueries = coerceLlmStringList(r.searchQueries, MAX_QUERIES)
    if (kind === 'lora' || kind === 'textual_inversion') {
      if (modelTags.length === 0 && searchQueries.length === 0) continue
    }
    out.push({ kind, titleZh, detailZh, modelTags, searchQueries })
  }
  return out
}

function civitaiTypesForKind(kind: AssistantResourceExtraKind): string | undefined {
  if (kind === 'lora') return 'LORA'
  if (kind === 'textual_inversion') return 'TextualInversion'
  return undefined
}

export async function resolveAssistantResourceExtras(
  env: ServerEnv,
  specs: AssistantResourceExtraSpec[],
  opts: { perSearchLimit: number; resultLimit: number; nsfw: boolean },
): Promise<AssistantResourceExtraResolved[]> {
  const out: AssistantResourceExtraResolved[] = []
  for (const spec of specs) {
    const types = civitaiTypesForKind(spec.kind)
    let recommendedModels: CivitaiModelRow[] = []
    if (types && (spec.modelTags.length > 0 || spec.searchQueries.length > 0)) {
      try {
        recommendedModels = await mergeHotCivitaiModelsByTagsAndQueries(env, {
          modelTags: spec.modelTags,
          searchQueries: spec.searchQueries,
          perSearchLimit: opts.perSearchLimit,
          resultLimit: opts.resultLimit,
          types,
          nsfw: opts.nsfw,
        })
      } catch {
        recommendedModels = []
      }
    }
    out.push({ ...spec, recommendedModels })
  }
  return out
}
