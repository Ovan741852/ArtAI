import { parseModelBundleAssistantFinalPayload, type ModelBundleAssistantOkData } from './modelBundleAssistant'

function resolveArtaiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : '')
  const baseTrim = base.replace(/\/+$/, '')
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  if (!baseTrim) return path
  return `${baseTrim}${path}`
}

function parseFinalPayload(o: Record<string, unknown>): ModelBundleAssistantOkData | null {
  return parseModelBundleAssistantFinalPayload(o)
}

export type ModelBundleAssistantStreamHandlers = {
  onDelta: (text: string) => void
  onFinal: (data: ModelBundleAssistantOkData) => void
}

/**
 * `POST /civitai/model-bundles/assistant/chat-stream`：讀取 NDJSON 串流。
 */
export async function postModelBundleAssistantChatStream(
  body: Record<string, unknown>,
  handlers: ModelBundleAssistantStreamHandlers,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = resolveArtaiUrl('/civitai/model-bundles/assistant/chat-stream')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = res.statusText || 'Request failed'
    const ct = res.headers.get('content-type') ?? ''
    try {
      const rawText = await res.text()
      if (ct.includes('application/json') && rawText.trim()) {
        const j = JSON.parse(rawText) as unknown
        if (j != null && typeof j === 'object' && 'message' in j) {
          const m = (j as { message?: unknown }).message
          if (typeof m === 'string' && m.trim()) detail = m.trim()
        }
      } else if (rawText.trim() && rawText.length < 500) {
        detail = rawText.trim()
      }
    } catch {
      /* keep detail */
    }
    return { ok: false, message: `HTTP ${String(res.status)}: ${detail}` }
  }

  if (!res.body) {
    return { ok: false, message: '回應無 body（無法串流）' }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    if (done) {
      buf += decoder.decode()
    }

    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let row: Record<string, unknown>
      try {
        row = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const typ = row.type
      if (typ === 'delta' && typeof row.text === 'string') {
        handlers.onDelta(row.text)
      } else if (typ === 'final') {
        const parsed = parseFinalPayload(row)
        if (!parsed) return { ok: false, message: 'final 列格式異常' }
        handlers.onFinal(parsed)
        return { ok: true }
      } else if (typ === 'error') {
        const m = typeof row.message === 'string' ? row.message : '串流錯誤'
        return { ok: false, message: m }
      }
    }

    if (done) break
  }

  return { ok: false, message: '串流結束但未收到 final' }
}
