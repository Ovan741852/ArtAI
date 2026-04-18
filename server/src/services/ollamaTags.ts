/**
 * 本機 Ollama HTTP API：`GET /api/tags` 列出已 pull 的模型。
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */

const TAGS_PATH = '/api/tags'

/** Ollama `/api/tags` 單筆 model；其餘欄位依版本可能增減，故用 loose 型別。 */
export type OllamaTagModel = {
  name: string
  model?: string
  modified_at?: string
  size?: number
  digest?: string
  details?: Record<string, unknown>
}

export type OllamaTagsPayload = {
  models: OllamaTagModel[]
}

export async function fetchOllamaTags(ollamaBaseUrl: string): Promise<OllamaTagsPayload> {
  const base = ollamaBaseUrl.replace(/\/+$/, '')
  const url = `${base}${TAGS_PATH}`

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  const bodyText = await res.text()
  if (!res.ok) {
    const snippet = bodyText.length > 200 ? `${bodyText.slice(0, 200)}…` : bodyText
    throw new Error(`Ollama ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText) as unknown
  } catch {
    throw new Error('Ollama returned non-JSON body for /api/tags')
  }

  if (data == null || typeof data !== 'object' || !('models' in data)) {
    throw new Error('Ollama /api/tags: expected JSON object with "models"')
  }

  const models = (data as { models: unknown }).models
  if (!Array.isArray(models)) {
    throw new Error('Ollama /api/tags: "models" must be an array')
  }

  const normalized: OllamaTagModel[] = models.map((m) => {
    if (m != null && typeof m === 'object' && 'name' in m && typeof (m as { name: unknown }).name === 'string') {
      return m as OllamaTagModel
    }
    return { name: String(m) }
  })

  return { models: normalized }
}
