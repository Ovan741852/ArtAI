import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { searchCivitaiModels, type CivitaiModelItem } from '../services/civitaiSearchModels.js'
import { stripHtml } from '../lib/stripHtml.js'
import { ollamaGenerateNonStream } from '../services/ollamaGenerate.js'

function clampInt(raw: string | undefined, lo: number, hi: number, fallback: number): number {
  const n = raw == null || raw === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.floor(n)))
}

function mapModelRow(item: CivitaiModelItem) {
  const versions = (item.modelVersions ?? []).slice(0, 5).map((v) => ({
    id: v.id,
    name: v.name,
    baseModel: v.baseModel,
    trainedWords: v.trainedWords ?? [],
    descriptionText: stripHtml(v.description ?? ''),
  }))

  return {
    id: item.id,
    name: item.name,
    type: item.type,
    nsfw: item.nsfw,
    tags: item.tags,
    creatorUsername: item.creator?.username,
    stats: item.stats,
    descriptionText: stripHtml(item.description ?? ''),
    descriptionHtml: item.description ?? null,
    modelVersionsPreview: versions,
    civitaiUrl: `https://civitai.com/models/${item.id}`,
  }
}

export function createCivitaiModelsSearchRoutes(env: ServerEnv) {
  const r = new Hono()

  /**
   * 關鍵字搜尋 Civitai 模型（轉發 `GET /api/v1/models`）。
   * Query 參數：query（必填）, types, tag, sort, baseModels, limit, nsfw,
   * summarize=1 時以本地 Ollama 總結前幾筆的 description；ollamaModel、summarizeLimit。
   */
  r.get('/civitai/models/search', async (c) => {
    const query = c.req.query('query')?.trim()
    if (!query) {
      return c.json({ ok: false, message: 'Missing required query parameter: query' }, 400)
    }

    const types = c.req.query('types')?.trim()
    const tag = c.req.query('tag')?.trim()
    const sort = c.req.query('sort')?.trim()
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
        query,
        limit,
        types: types && types !== '' ? types : undefined,
        tag,
        sort,
        baseModels,
        nsfw,
      })

      const rows = items.map(mapModelRow)

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

        const prompt = [
          '你是熟悉 Civitai、Stable Diffusion 與 ComfyUI 的助手。',
          `以下 JSON 為 Civitai 官方 API 依關鍵字「${query}」搜尋到的前 ${String(slice.length)} 筆模型（description 已去 HTML，僅供參考）。`,
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
        query,
        filters: { types: types || null, tag: tag || null, sort: sort || null, baseModels: baseModels || null, limit, nsfw },
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

  return r
}
