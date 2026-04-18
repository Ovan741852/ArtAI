/**
 * 將後端常見的「外層包一層字串 JSON」或 value / extend / content 等欄位
 * 收斂成單一 payload，避免每個封包各自 JSON.parse 與欄位猜測。
 */
const NESTED_STRING_KEYS = ['value', 'extend', 'content', 'payload', 'data', 'body'] as const

function tryParseJsonString(s: string): unknown {
  const t = s.trim()
  if (!t) return s
  try {
    return JSON.parse(t) as unknown
  } catch {
    return s
  }
}

export function normalizePacketPayload(raw: unknown): unknown {
  if (raw == null) return raw

  if (typeof raw === 'string') {
    return normalizePacketPayload(tryParseJsonString(raw))
  }

  if (typeof raw !== 'object') return raw

  const o = raw as Record<string, unknown>
  for (const key of NESTED_STRING_KEYS) {
    if (!(key in o)) continue
    const v = o[key]
    if (v == null) continue
    if (typeof v === 'string') {
      return normalizePacketPayload(tryParseJsonString(v))
    }
    return v
  }

  return raw
}

/**
 * 常見業務包：{ code, message?, data? }；code !== 0 時轉成可預期的錯誤。
 */
export type ApiEnvelope<T> = {
  code: number
  message?: string
  data?: T
}

export function unwrapApiEnvelope<T>(payload: unknown): T {
  if (payload == null || typeof payload !== 'object') {
    throw { kind: 'parse' as const, message: 'Invalid API envelope' }
  }
  const o = payload as ApiEnvelope<T>
  if (typeof o.code !== 'number') {
    return payload as T
  }
  if (o.code !== 0) {
    throw {
      kind: 'parse' as const,
      message: o.message ?? `API code ${o.code}`,
    }
  }
  return (o.data ?? o) as T
}
