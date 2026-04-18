/**
 * User-visible one-line reply from LLM JSON (`replyZh` key is historical; any language OK).
 * Returns "" when missing or not a string.
 */
export function readOptionalAssistantReplyLine(x: unknown): string {
  if (typeof x !== 'string') return ''
  return x.trim()
}

/** Ollama `format: json` often omits or whitespace-pads optional prose fields. */
export function readOptionalUnderstandingZh(raw: unknown, maxLen = 1200): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return raw.trim().slice(0, maxLen)
}

/**
 * Never fail the HTTP handler because `replyZh` was omitted or blank — chain fallbacks instead.
 * Order: reply → trimmed understanding (sliced) → secondary → tertiary → finalFallback.
 */
export function resolveAssistantReplyZh(p: {
  replyRaw: unknown
  understandingZh?: string | undefined
  secondaryLine?: string | undefined
  tertiaryLine?: string | undefined
  finalFallback: string
  understandingSliceLen?: number
}): string {
  const primary = readOptionalAssistantReplyLine(p.replyRaw)
  if (primary) return primary
  const u = p.understandingZh?.trim()
  const slice = p.understandingSliceLen ?? 220
  if (u) return u.slice(0, slice)
  const s = p.secondaryLine?.trim()
  if (s) return s
  const t = p.tertiaryLine?.trim()
  if (t) return t
  return p.finalFallback
}

/** Keep in sync with `web/src/net/protocol/assistantUserReplyLine.ts` (creative loop chat decode). */
export const CREATIVE_LOOP_ASSISTANT_REPLY_FALLBACK_ZH =
  '已根據對話整理建議與參數調整，請查看預覽後再執行。'

export const CREATIVE_LOOP_RESOURCE_REPLY_FALLBACK_ZH = '已整理資源清單，請依項目安裝或確認。'

export const WORKFLOW_ASSISTANT_REPLY_FALLBACK_EN =
  'Pick a template or describe what you want to change.'

export const MODEL_BUNDLE_ASSISTANT_REPLY_FALLBACK_EN = 'See download bundles below.'

export const CHECKPOINT_TAG_DISCOVERY_FALLBACK_EN = 'See recommended checkpoints and resources below.'

/** When the model omits a reply, derive a short English line from discovery fields. */
export function fallbackReplyFromDiscoveryTags(modelTags: string[], searchQueries: string[]): string {
  const parts = [...modelTags, ...searchQueries].filter(Boolean)
  if (parts.length > 0) {
    return `Suggestions: ${parts.slice(0, 12).join(', ')}.`
  }
  return CHECKPOINT_TAG_DISCOVERY_FALLBACK_EN
}
