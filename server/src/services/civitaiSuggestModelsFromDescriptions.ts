import type { ServerEnv } from '../config/env.js'
import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { mapCivitaiModelRow, type CivitaiModelRow } from './civitaiModelRowMap.js'
import { searchCivitaiModels, type CivitaiModelItem } from './civitaiSearchModels.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'

export type SuggestModelsFromDescriptionsBody = {
  /** 一則或多則對目標畫面／風格的描述（繁中、英文皆可）。 */
  descriptions: string | string[]
  /** 例如 `llama3.2:latest`；省略時使用 `OLLAMA_SUMMARY_MODEL`。 */
  ollamaModel?: string
  /** 例如 `Checkpoint` 或 `Checkpoint,LORA`；省略則不限類型。 */
  types?: string
  nsfw?: boolean
  /** 每個 tag／關鍵字搜尋向 Civitai 取的筆數上限，預設 12。 */
  perSearchLimit?: number
  /** 最終回傳幾筆模型，預設 5。 */
  limit?: number
}

function normalizeDescriptions(input: string | string[]): string {
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(Boolean).join('\n\n')
  }
  return String(input).trim()
}

function readStringList(x: unknown, field: string, max: number): string[] {
  if (x === undefined || x === null) return []
  if (!Array.isArray(x)) throw new AppHttpError(502, `LLM JSON: "${field}" must be an array or omitted`)
  const out: string[] = []
  for (const el of x) {
    if (typeof el !== 'string') continue
    const t = el.trim()
    if (t) out.push(t)
    if (out.length >= max) break
  }
  return out
}

function downloadCount(item: CivitaiModelItem): number {
  const s = item.stats
  if (s != null && typeof s === 'object' && 'downloadCount' in s) {
    const n = (s as { downloadCount?: unknown }).downloadCount
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return 0
}

const SORT_HOT = 'Most Downloaded'
const PERIOD_ALL = 'AllTime'

export type SuggestModelsFromDescriptionsResult = {
  descriptionsUsed: string
  ollamaModel: string
  llm: {
    modelTags: string[]
    searchQueries: string[]
  }
  civitaiFilters: {
    sort: typeof SORT_HOT
    period: typeof PERIOD_ALL
    types: string | null
    nsfw: boolean
  }
  models: CivitaiModelRow[]
}

export async function runSuggestModelsFromDescriptions(
  env: ServerEnv,
  body: SuggestModelsFromDescriptionsBody,
): Promise<SuggestModelsFromDescriptionsResult> {
  const descriptionsUsed = normalizeDescriptions(body.descriptions)
  if (!descriptionsUsed) {
    throw new AppHttpError(400, 'Body field "descriptions" is required (non-empty string or string[])')
  }

  const ollamaModel = body.ollamaModel?.trim() || env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(
      400,
      'Ollama model is required: pass "ollamaModel" in JSON or set env OLLAMA_SUMMARY_MODEL',
    )
  }

  const perSearchLimit = Math.min(100, Math.max(1, Math.floor(body.perSearchLimit ?? 12)))
  const resultLimit = Math.min(20, Math.max(1, Math.floor(body.limit ?? 5)))
  const types = body.types?.trim() || undefined
  const nsfw = body.nsfw === false ? false : true

  const prompt = [
    'You map image-generation intent to Civitai discovery metadata.',
    'Given the user descriptions (any language), infer:',
    '- modelTags: 1-5 strings that are plausible Civitai MODEL TAGS (English, lowercase or short hyphenated tokens common on Civitai: e.g. anime, photorealistic, architecture, fantasy, sci-fi, character, portrait).',
    '- searchQueries: 0-3 SHORT English keyword phrases for Civitai name search when tags alone may miss (e.g. "realistic vision sdxl", "anime pastell").',
    'Rules: respond with ONE JSON object only, no markdown, no commentary.',
    'Keys exactly: "modelTags" (string array), "searchQueries" (string array).',
    'Do not invent model names as tags; prefer broad style/subject tags.',
    '',
    'User descriptions:',
    descriptionsUsed,
  ].join('\n')

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: ollamaModel,
    prompt,
  })

  let parsed: unknown
  try {
    parsed = parseJsonObjectFromLlm(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Failed to parse LLM JSON: ${msg}`)
  }

  if (parsed == null || typeof parsed !== 'object') {
    throw new AppHttpError(502, 'LLM JSON: expected an object')
  }

  const o = parsed as Record<string, unknown>
  const modelTags = readStringList(o.modelTags, 'modelTags', 5)
  const searchQueries = readStringList(o.searchQueries, 'searchQueries', 3)

  if (modelTags.length === 0 && searchQueries.length === 0) {
    throw new AppHttpError(502, 'LLM returned no modelTags and no searchQueries')
  }

  const baseSearch = {
    civitaiBaseUrl: env.civitaiBaseUrl,
    apiKey: env.civitaiApiKey,
    sort: SORT_HOT,
    period: PERIOD_ALL,
    limit: perSearchLimit,
    types,
    nsfw,
  }

  const byId = new Map<number, CivitaiModelItem>()

  const runSearch = async (partial: { tag?: string; query?: string }) => {
    const { items } = await searchCivitaiModels({ ...baseSearch, ...partial })
    for (const it of items) {
      if (!byId.has(it.id)) byId.set(it.id, it)
    }
  }

  for (const tag of modelTags) {
    await runSearch({ tag })
  }

  if (byId.size < resultLimit) {
    for (const query of searchQueries) {
      if (byId.size >= resultLimit * 3) break
      await runSearch({ query })
    }
  }

  const merged = [...byId.values()].sort((a, b) => downloadCount(b) - downloadCount(a))
  const top = merged.slice(0, resultLimit).map(mapCivitaiModelRow)

  return {
    descriptionsUsed,
    ollamaModel,
    llm: { modelTags, searchQueries },
    civitaiFilters: { sort: SORT_HOT, period: PERIOD_ALL, types: types ?? null, nsfw },
    models: top,
  }
}
