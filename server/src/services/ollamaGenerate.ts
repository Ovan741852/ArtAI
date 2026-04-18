type OllamaGenerateOk = {
  response?: string
}

function buildGenerateBody(params: {
  model: string
  prompt: string
  stream: boolean
  images?: string[]
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    stream: params.stream,
  }
  const imgs = params.images?.filter((s) => typeof s === 'string' && s.trim() !== '')
  if (imgs && imgs.length > 0) {
    body.images = imgs
  }
  return body
}

export async function ollamaGenerateNonStream(params: {
  ollamaBaseUrl: string
  model: string
  prompt: string
  /**
   * Base64-encoded images (no `data:image/...;base64,` prefix).需使用 Ollama 支援視覺的模型（如 llava）。
   * @see https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-completion
   */
  images?: string[]
}): Promise<string> {
  const base = params.ollamaBaseUrl.replace(/\/+$/, '')
  const url = `${base}/api/generate`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(buildGenerateBody({ ...params, stream: false })),
  })

  const bodyText = await res.text()
  if (!res.ok) {
    const snippet = bodyText.length > 280 ? `${bodyText.slice(0, 280)}…` : bodyText
    throw new Error(`Ollama generate ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText) as unknown
  } catch {
    throw new Error('Ollama /api/generate: response is not JSON')
  }

  const rsp = (data as OllamaGenerateOk).response
  if (typeof rsp !== 'string' || rsp.trim() === '') {
    throw new Error('Ollama /api/generate: missing "response" string')
  }

  return rsp
}

/**
 * Ollama `stream: true`：逐行 JSON，累加 `response` 欄位；每收到一段呼叫 `onToken`。
 * @returns 完整拼接後的 `response` 字串
 */
export async function ollamaGenerateStreamCollect(params: {
  ollamaBaseUrl: string
  model: string
  prompt: string
  images?: string[]
  onToken?: (chunk: string) => void | Promise<void>
  signal?: AbortSignal
}): Promise<string> {
  const base = params.ollamaBaseUrl.replace(/\/+$/, '')
  const url = `${base}/api/generate`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(buildGenerateBody({ ...params, stream: true })),
    signal: params.signal,
  })

  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 400)
    throw new Error(`Ollama generate ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  if (!res.body) {
    throw new Error('Ollama /api/generate: stream response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let lineBuffer = ''
  let full = ''

  const flushLines = async (flushLast: boolean) => {
    const parts = lineBuffer.split('\n')
    if (flushLast) {
      lineBuffer = ''
    } else {
      lineBuffer = parts.pop() ?? ''
    }
    for (const line of parts) {
      const t = line.trim()
      if (!t) continue
      let j: Record<string, unknown>
      try {
        j = JSON.parse(t) as Record<string, unknown>
      } catch {
        continue
      }
      const piece = j.response
      if (typeof piece === 'string' && piece.length > 0) {
        full += piece
        await params.onToken?.(piece)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) {
      lineBuffer += decoder.decode(value, { stream: true })
      await flushLines(false)
    }
    if (done) {
      lineBuffer += decoder.decode()
      await flushLines(true)
      break
    }
  }

  return full
}
