/**
 * Civitai Public REST：`GET /api/v1/models`（`query`、`types`、`tag`、`sort`、`baseModels` 等見官方文件）。
 * 認證：`Authorization: Bearer {api_key}`（見 Authorization 章節）。
 * @see https://github.com/civitai/civitai/wiki/REST-API-Reference#get-apiv1models（同頁另有 `GET /api/v1/models/:modelId`）
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
  /** 依模型名稱關鍵字過濾；與 `tag` 至少擇一（官方兩者皆選填，但全空時結果過大）。 */
  query?: string
  limit?: number
  /** 逗號分隔，例如 `Checkpoint` 或 `Checkpoint,LORA`；省略則不帶參數（官方預設為全部種類）。 */
  types?: string
  tag?: string
  sort?: string
  /** 與 `sort` 搭配，例如 `AllTime`、`Month`（見官方文件）。 */
  period?: string
  /** 逗號分隔底模，例如 `SDXL 1.0,SD 1.5`（會拆成多個 `baseModels` query）。 */
  baseModels?: string
  /** 預設 true，與既有 checkpoint 搜尋行為一致。 */
  nsfw?: boolean
}

export type CivitaiModelsSearchResult = {
  items: CivitaiModelItem[]
  metadata: unknown
}

export type CivitaiModelByIdParams = {
  civitaiBaseUrl: string
  apiKey?: string
  modelId: number
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

  const queryTrimmed = params.query?.trim()
  const tagTrimmed = params.tag?.trim()
  if (!queryTrimmed && !tagTrimmed) {
    throw new Error('Civitai /api/v1/models: provide query and/or tag')
  }
  if (queryTrimmed) url.searchParams.set('query', queryTrimmed)
  if (tagTrimmed) url.searchParams.set('tag', tagTrimmed)

  const limit = params.limit ?? 20
  url.searchParams.set('limit', String(Math.min(100, Math.max(1, limit))))

  appendCsvParams(url, 'types', params.types)
  if (params.sort?.trim()) url.searchParams.set('sort', params.sort.trim())
  if (params.period?.trim()) url.searchParams.set('period', params.period.trim())
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

/**
 * 呼叫 Civitai `GET /api/v1/models/{modelId}`，回傳單筆完整模型（含 description、tags、modelVersions 等）。
 * 不存在時回傳 `null`（HTTP 404）。
 */
export async function fetchCivitaiModelById(params: CivitaiModelByIdParams): Promise<CivitaiModelItem | null> {
  const base = params.civitaiBaseUrl.replace(/\/+$/, '')
  const url = `${base}/api/v1/models/${params.modelId}`

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...buildAuthHeaders(params.apiKey),
    },
  })

  const bodyText = await res.text()
  if (res.status === 404) return null
  if (!res.ok) {
    const snippet = bodyText.length > 240 ? `${bodyText.slice(0, 240)}…` : bodyText
    throw new Error(`Civitai ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText) as unknown
  } catch {
    throw new Error('Civitai /api/v1/models/{id}: response is not JSON')
  }

  if (data == null || typeof data !== 'object') {
    throw new Error('Civitai /api/v1/models/{id}: expected a JSON object')
  }

  const o = data as Record<string, unknown>
  if (typeof o.id !== 'number' || typeof o.name !== 'string') {
    throw new Error('Civitai /api/v1/models/{id}: expected model object with numeric id and string name')
  }

  return data as CivitaiModelItem
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
