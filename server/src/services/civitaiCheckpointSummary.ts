import { stripHtml } from '../lib/stripHtml.js'
import type { ServerEnv } from '../config/env.js'
import { searchCheckpointModels, type CivitaiModelItem, type CivitaiModelVersion } from './civitaiSearchModels.js'
import { pickCheckpointFromCivitaiItems, stemFileName, type CheckpointPickQuality } from './civitaiPickCheckpoint.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'

export class AppHttpError extends Error {
  /**
   * 選填；例如摳圖全失敗時附 `attemptErrors`、`warnings` 供客戶端不必看伺服器 log。
   */
  readonly extra?: Record<string, unknown>

  constructor(readonly status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'AppHttpError'
    this.extra = extra
  }
}

export type CheckpointSummaryBody = {
  checkpoint: string
  /** 例如 `llama3.2:latest`；省略時使用 `OLLAMA_SUMMARY_MODEL` */
  ollamaModel?: string
  /**
   * 覆寫送給 Civitai `GET /api/v1/models?query=` 的字串（檔名與站上標題不一致時用）。
   * 例：`FLUX.1 dev`、`flux dev`。
   */
  searchQuery?: string
}

function uniqSearchQueries(candidates: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const q = raw.trim().replace(/\s+/g, ' ')
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  return out
}

/**
 * 由本機檔名主幹產生多組 Civitai 搜尋字串（檔名很少與創作者標題完全一致）。
 */
function buildCivitaiSearchQueriesFromStem(stem: string): string[] {
  const noQuant = stem.replace(/-(fp8|fp16|bf16|q\d+(?:_\d+)?)$/i, '')
  const parts = stem.split('-').filter(Boolean)
  const head2 = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : ''

  return uniqSearchQueries([
    stem,
    stem.replace(/_/g, ' '),
    stem.replace(/-/g, ' '),
    stem.replace(/[_-]+/g, ' '),
    noQuant,
    noQuant.replace(/-/g, ' '),
    noQuant.replace(/_/g, ' '),
    head2,
  ])
}

export type CivitaiCheckpointResolveResult = {
  checkpoint: string
  civitaiSearchQuery: string
  civitaiSearchQueriesTried: string[]
  matchQuality: CheckpointPickQuality
  civitaiSearchHitCount: number
  item: CivitaiModelItem
  version: CivitaiModelVersion
}

/**
 * 依本機 checkpoint 檔名在 Civitai（types=Checkpoint）搜尋並挑出最可能的一筆 model + version。
 * 供 Ollama 摘要與「本機目錄同步」等流程重用。
 */
export async function findCivitaiForLocalCheckpoint(
  env: ServerEnv,
  input: Pick<CheckpointSummaryBody, 'checkpoint' | 'searchQuery'>,
): Promise<CivitaiCheckpointResolveResult> {
  const checkpoint = input.checkpoint?.trim()
  if (!checkpoint) {
    throw new AppHttpError(400, 'Body field "checkpoint" is required (e.g. "realisticVisionV51_v51VAE.safetensors")')
  }

  const qStem = stemFileName(checkpoint)
  const manualQuery = input.searchQuery?.trim()
  const searchQueries = uniqSearchQueries([
    ...(manualQuery ? [manualQuery] : []),
    ...buildCivitaiSearchQueriesFromStem(qStem),
  ])

  const trySearch = async (q: string) =>
    searchCheckpointModels({
      civitaiBaseUrl: env.civitaiBaseUrl,
      query: q,
      apiKey: env.civitaiApiKey,
      limit: 20,
    })

  let items: Awaited<ReturnType<typeof searchCheckpointModels>> = []
  let civitaiSearchQueryUsed = ''
  for (const q of searchQueries) {
    items = await trySearch(q)
    if (items.length > 0) {
      civitaiSearchQueryUsed = q
      break
    }
  }

  if (items.length === 0) {
    throw new AppHttpError(
      404,
      `Civitai 在 types=Checkpoint 下找不到與「${checkpoint}」相關的結果（已嘗試 query：${searchQueries.slice(0, 6).join(' → ')}${searchQueries.length > 6 ? ' …' : ''}）。` +
        `檔名常與站上標題不同，請在 JSON 加 \"searchQuery\"（例如 \"FLUX.1 dev\" 或 \"flux dev\"）再試。`,
    )
  }

  const picked = pickCheckpointFromCivitaiItems(checkpoint, items)
  if (!picked) {
    throw new AppHttpError(404, 'Civitai returned items but no model versions were available to pick from')
  }

  const { item, version, quality } = picked
  return {
    checkpoint,
    civitaiSearchQuery: civitaiSearchQueryUsed,
    civitaiSearchQueriesTried: searchQueries,
    matchQuality: quality,
    civitaiSearchHitCount: items.length,
    item,
    version,
  }
}

export async function runCheckpointSummary(env: ServerEnv, input: CheckpointSummaryBody) {
  const ollamaModel = input.ollamaModel?.trim() || env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(
      400,
      'Ollama model is required: pass "ollamaModel" in JSON or set env OLLAMA_SUMMARY_MODEL',
    )
  }

  const { checkpoint, civitaiSearchQuery, civitaiSearchQueriesTried, matchQuality, civitaiSearchHitCount, item, version } =
    await findCivitaiForLocalCheckpoint(env, input)

  const modelDescription = stripHtml(item.description ?? '')
  const versionDescription = stripHtml(version.description ?? '')

  const civitaiForLlm = {
    civitaiModelId: item.id,
    civitaiModelUrl: `https://civitai.com/models/${item.id}`,
    modelName: item.name,
    modelDescription,
    versionId: version.id,
    versionName: version.name ?? '',
    versionDescription,
    trainedWords: version.trainedWords ?? [],
    baseModel: version.baseModel ?? '',
  }

  const prompt = [
    'You are an assistant familiar with Stable Diffusion, ComfyUI, and Civitai.',
    'The JSON below is from the official Civitai API (creator descriptions, version notes, trained words, base model).',
    'Write a concise summary in **English** only:',
    '- Typical style, subjects, and use cases for this checkpoint',
    '- If trainedWords exist, how to use them; do not invent triggers not present in the JSON',
    '- What baseModel implies for compatibility',
    'Do not guess beyond the JSON; say clearly if data is insufficient.',
    '',
    JSON.stringify(civitaiForLlm, null, 2),
  ].join('\n')

  const summary = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: ollamaModel,
    prompt,
  })

  return {
    checkpoint,
    civitaiSearchQuery,
    civitaiSearchQueriesTried,
    matchQuality,
    civitaiSearchHitCount,
    ...civitaiForLlm,
    civitaiHtml: {
      modelDescription: item.description ?? null,
      versionDescription: version.description ?? null,
    },
    summary,
    ollamaModel,
  }
}
