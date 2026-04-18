import { parseAssistantResourceExtrasPayload } from './assistantResourceExtras'
import type { CheckpointTagAssistantOkData } from './checkpointTagAssistant'

function resolveArtaiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : '')
  const baseTrim = base.replace(/\/+$/, '')
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  if (!baseTrim) return path
  return `${baseTrim}${path}`
}

function parseFinalPayload(o: Record<string, unknown>): CheckpointTagAssistantOkData | null {
  if (o.ok !== true) return null
  const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : ''
  const imageAttached = o.imageAttached === true
  const assistantRaw = o.assistant
  if (!assistantRaw || typeof assistantRaw !== 'object') return null
  const a = assistantRaw as Record<string, unknown>
  const replyZh = typeof a.replyZh === 'string' ? a.replyZh : ''
  const modelTags = Array.isArray(a.modelTags) ? a.modelTags.filter((x): x is string => typeof x === 'string') : []
  const searchQueries = Array.isArray(a.searchQueries)
    ? a.searchQueries.filter((x): x is string => typeof x === 'string')
    : []
  const recommendedModels = Array.isArray(o.recommendedModels) ? o.recommendedModels : []
  const localCheckpoints = Array.isArray(o.localCheckpoints) ? o.localCheckpoints : []

  const resourceExtras = parseAssistantResourceExtrasPayload(o.resourceExtras)

  return {
    ollamaModel,
    imageAttached,
    localCheckpoints: localCheckpoints as CheckpointTagAssistantOkData['localCheckpoints'],
    assistant: { replyZh, modelTags, searchQueries },
    recommendedModels: recommendedModels as CheckpointTagAssistantOkData['recommendedModels'],
    resourceExtras,
  }
}

export type CheckpointTagAssistantStreamHandlers = {
  onDelta: (text: string) => void
  onFinal: (data: CheckpointTagAssistantOkData) => void
}

/**
 * `POST /civitai/checkpoint/tag-assistant/chat-stream`：讀取 NDJSON 串流。
 * 成功回 `{ ok: true }`；失敗回 `{ ok: false, message }`（已呼叫過 `onDelta` 的片段不會自動還原，請由呼叫端處理 UI）。
 */
export async function postCheckpointTagAssistantChatStream(
  body: Record<string, unknown>,
  handlers: CheckpointTagAssistantStreamHandlers,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = resolveArtaiUrl('/civitai/checkpoint/tag-assistant/chat-stream')
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
