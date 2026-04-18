import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import { fetchCivitaiModelById, searchCivitaiModels } from '../services/civitaiSearchModels.js'
import { mapCivitaiModelRow } from '../services/civitaiModelRowMap.js'
import {
  runSuggestModelsFromDescriptions,
  type SuggestModelsFromDescriptionsBody,
} from '../services/civitaiSuggestModelsFromDescriptions.js'
import { ollamaGenerateNonStream } from '../services/ollamaGenerate.js'

function clampInt(raw: string | undefined, lo: number, hi: number, fallback: number): number {
  const n = raw == null || raw === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.floor(n)))
}

export function createCivitaiModelsSearchRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 關鍵字搜尋 Civitai 模型（轉發 `GET /api/v1/models`）。
   * Query 參數：`query` 與 `tag` 至少擇一；types、sort、period、baseModels、limit、nsfw；
   * summarize=1 時以本地 Ollama 總結前幾筆的 description；ollamaModel、summarizeLimit。
   */
  r.get('/civitai/models/search', async (c) => {
    const query = c.req.query('query')?.trim()
    const types = c.req.query('types')?.trim()
    const tag = c.req.query('tag')?.trim()
    if (!query && !tag) {
      return c.json({ ok: false, message: 'Missing required query parameter: query or tag' }, 400)
    }
    const sort = c.req.query('sort')?.trim()
    const period = c.req.query('period')?.trim()
    const baseModels = c.req.query('baseModels')?.trim()
    const limit = clampInt(c.req.query('limit'), 1, 100, 20)
    const nsfwRaw = c.req.query('nsfw')?.toLowerCase()
    const nsfw = nsfwRaw === 'false' || nsfwRaw === '0' ? false : true

    const summarize =
      c.req.query('summarize') === '1' ||
      c.req.query('summarize') === 'true' ||
      c.req.query('summarize') === 'yes'
    const summarizeLimit = clampInt(c.req.query('summarizeLimit'), 1, 15, 5)
    const ollamaModel = c.req.query('ollamaModel')?.trim() || env.ollamaSummaryModel

    try {
      const { items, metadata } = await searchCivitaiModels({
        civitaiBaseUrl: env.civitaiBaseUrl,
        apiKey: env.civitaiApiKey,
        query: query || undefined,
        limit,
        types: types && types !== '' ? types : undefined,
        tag,
        sort,
        period,
        baseModels,
        nsfw,
      })

      const rows = items.map(mapCivitaiModelRow)

      let summary: string | undefined
      if (summarize) {
        if (!ollamaModel) {
          return c.json(
            { ok: false, message: 'summarize=1 requires ollamaModel query param or OLLAMA_SUMMARY_MODEL env' },
            400,
          )
        }
        const slice = rows.slice(0, summarizeLimit).map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          descriptionText: row.descriptionText,
          modelVersionsPreview: row.modelVersionsPreview,
        }))

        const searchLabel = query || (tag ? `tag:${tag}` : '')
        const prompt = [
          '你是熟悉 Civitai、Stable Diffusion 與 ComfyUI 的助手。',
          `以下 JSON 為 Civitai 官方 API 依「${searchLabel}」搜尋到的前 ${String(slice.length)} 筆模型（description 已去 HTML，僅供參考）。`,
          '請用繁體中文條列：每一個模型大致用途、風格或適用情境；若有 trainedWords / baseModel 可一併說明。',
          '請勿臆測 JSON 未出現的內容；若某筆幾乎無描述請直接寫「此筆頁面說明較少」。',
          '',
          JSON.stringify(slice, null, 2),
        ].join('\n')

        summary = await ollamaGenerateNonStream({
          ollamaBaseUrl: env.ollamaBaseUrl,
          model: ollamaModel,
          prompt,
        })
      }

      return c.json({
        ok: true,
        query: query || null,
        filters: {
          types: types || null,
          tag: tag || null,
          sort: sort || null,
          period: period || null,
          baseModels: baseModels || null,
          limit,
          nsfw,
        },
        civitaiMetadata: metadata,
        hitCount: rows.length,
        models: rows,
        ...(summarize ? { summary, ollamaModel, summarizeLimit } : {}),
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  /**
   * 依多則畫面描述，由 Ollama 推斷 Civitai 風格 tag／關鍵字，再以 `GET /api/v1/models` 依「Most Downloaded + AllTime」合併去重後取最熱門若干筆。
   */
  r.post('/civitai/models/suggest-from-descriptions', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Invalid JSON body' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }

    try {
      const result = await runSuggestModelsFromDescriptions(env, body as SuggestModelsFromDescriptionsBody)
      return c.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof AppHttpError) {
        return c.json({ ok: false, message: e.message }, e.status as 400 | 404 | 502)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  /** 依 Civitai 模型 ID 取得完整資料（轉發 `GET /api/v1/models/{modelId}`）。須排在 `/civitai/models/search` 之後，否則 `search` 會被當成 `:id`。 */
  r.get('/civitai/models/:id', async (c) => {
    const idRaw = c.req.param('id')?.trim() ?? ''
    const modelId = Number(idRaw)
    if (!Number.isInteger(modelId) || modelId < 1) {
      return c.json({ ok: false, message: 'Invalid path parameter: id (positive integer required)' }, 400)
    }

    try {
      const item = await fetchCivitaiModelById({
        civitaiBaseUrl: env.civitaiBaseUrl,
        apiKey: env.civitaiApiKey,
        modelId,
      })
      if (!item) {
        return c.json({ ok: false, message: `Civitai model not found: ${String(modelId)}` }, 404)
      }
      return c.json({ ok: true, model: mapCivitaiModelRow(item) })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
