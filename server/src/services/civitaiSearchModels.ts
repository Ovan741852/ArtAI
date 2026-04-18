/**
 * Civitai Public REST：`GET /api/v1/models`（`query`、`types`、`tag`、`sort`、`baseModels` 等見官方文件）。
 * 認證：`Authorization: Bearer {api_key}`（見 Authorization 章節）。
 * @see https://github.com/civitai/civitai/wiki/REST-API-Reference#get-apiv1models
 * @see https://github.com/civitai/civitai/wiki/REST-API-Reference#authorization
 */

export type CivitaiModelFile = {
  name?: string
  primary?: boolean
}

export type CivitaiModelVersion = {
  id: number
  name?: string
  description?: string
  trainedWords?: string[]
  baseModel?: string
  createdAt?: string
  files?: CivitaiModelFile[]
}

export type CivitaiModelItem = {
  id: number
  name: string
  description?: string
  type?: string
  modelVersions?: CivitaiModelVersion[]
  nsfw?: boolean
  tags?: string[]
  creator?: { username?: string; image?: string | null }
  stats?: Record<string, unknown>
}

export type CivitaiModelsListResponse = {
  items?: CivitaiModelItem[]
  metadata?: unknown
}

export type CivitaiModelsSearchParams = {
  civitaiBaseUrl: string
  apiKey?: string
  /** 對應 Civitai `query`，依模型名稱關鍵字過濾（必填）。 */
  query: string
  limit?: number
  /** 逗號分隔，例如 `Checkpoint` 或 `Checkpoint,LORA`；省略則不帶參數（官方預設為全部種類）。 */
  types?: string
  tag?: string
  sort?: string
  /** 逗號分隔底模，例如 `SDXL 1.0,SD 1.5`（會拆成多個 `baseModels` query）。 */
  baseModels?: string
  /** 預設 true，與既有 checkpoint 搜尋行為一致。 */
  nsfw?: boolean
}

export type CivitaiModelsSearchResult = {
  items: CivitaiModelItem[]
  metadata: unknown
}

function buildAuthHeaders(apiKey: string | undefined): Record<string, string> {
  if (!apiKey) return {}
  return { Authorization: `Bearer ${apiKey}` }
}

function appendCsvParams(url: URL, key: string, csv: string | undefined) {
  if (!csv?.trim()) return
  for (const part of csv.split(',')) {
    const t = part.trim()
    if (t) url.searchParams.append(key, t)
  }
}

/**
 * 呼叫 Civitai `GET /api/v1/models`，支援官方文件列出的過濾參數。
 */
export async function searchCivitaiModels(params: CivitaiModelsSearchParams): Promise<CivitaiModelsSearchResult> {
  const base = params.civitaiBaseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}/api/v1/models`)
  url.searchParams.set('query', params.query)

  const limit = params.limit ?? 20
  url.searchParams.set('limit', String(Math.min(100, Math.max(1, limit))))

  appendCsvParams(url, 'types', params.types)
  if (params.tag?.trim()) url.searchParams.set('tag', params.tag.trim())
  if (params.sort?.trim()) url.searchParams.set('sort', params.sort.trim())
  appendCsvParams(url, 'baseModels', params.baseModels)

  url.searchParams.set('nsfw', params.nsfw === false ? 'false' : 'true')

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...buildAuthHeaders(params.apiKey),
    },
  })

  const bodyText = await res.text()
  if (!res.ok) {
    const snippet = bodyText.length > 240 ? `${bodyText.slice(0, 240)}…` : bodyText
    throw new Error(`Civitai ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText) as unknown
  } catch {
    throw new Error('Civitai /api/v1/models: response is not JSON')
  }

  if (data == null || typeof data !== 'object' || !('items' in data)) {
    throw new Error('Civitai /api/v1/models: expected object with "items"')
  }

  const itemsRaw = (data as CivitaiModelsListResponse).items
  if (!Array.isArray(itemsRaw)) {
    return { items: [], metadata: (data as CivitaiModelsListResponse).metadata ?? null }
  }

  const items = itemsRaw.filter(
    (x): x is CivitaiModelItem =>
      x != null && typeof x === 'object' && typeof x.id === 'number' && typeof x.name === 'string',
  )

  return {
    items,
    metadata: (data as CivitaiModelsListResponse).metadata ?? null,
  }
}

/** 僅搜 Checkpoint（給本機檔名對 Civitai 用）。 */
export async function searchCheckpointModels(params: {
  civitaiBaseUrl: string
  query: string
  apiKey?: string
  limit?: number
}): Promise<CivitaiModelItem[]> {
  const { items } = await searchCivitaiModels({
    civitaiBaseUrl: params.civitaiBaseUrl,
    apiKey: params.apiKey,
    query: params.query,
    limit: params.limit,
    types: 'Checkpoint',
  })
  return items
}
