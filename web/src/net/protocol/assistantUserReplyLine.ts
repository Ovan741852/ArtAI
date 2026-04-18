/**
 * Mirrors server `server/src/lib/assistantLlmUserReply.ts` for JSON decode paths.
 * Keep `CREATIVE_LOOP_ASSISTANT_REPLY_FALLBACK_ZH` aligned with the server export of the same name.
 */
export const CREATIVE_LOOP_ASSISTANT_REPLY_FALLBACK_ZH =
  '已根據對話整理建議與參數調整，請查看預覽後再執行。'

/** Keep in sync with `CREATIVE_LOOP_RESOURCE_REPLY_FALLBACK_ZH` on the server (`assistantLlmUserReply.ts`). */
export const CREATIVE_LOOP_RESOURCE_REPLY_FALLBACK_ZH = '已整理資源清單，請依項目安裝或確認。'

export function resolveAssistantReplyZhFromAssistantPayload(
  assistant: Record<string, unknown>,
  finalFallbackZh: string,
  secondaryZh?: string,
  understandingSliceLen = 220,
): string {
  const reply = typeof assistant.replyZh === 'string' ? assistant.replyZh.trim() : ''
  if (reply) return reply
  const u = typeof assistant.understandingZh === 'string' ? assistant.understandingZh.trim() : ''
  if (u) return u.slice(0, understandingSliceLen)
  const s = secondaryZh?.trim()
  if (s) return s
  return finalFallbackZh
}

/** For responses where `replyZh` is top-level (e.g. creative loop resource-check). */
export function resolveTopLevelReplyZhFromPayload(
  payload: Record<string, unknown>,
  finalFallbackZh: string,
  secondaryZh?: string,
): string {
  const reply = typeof payload.replyZh === 'string' ? payload.replyZh.trim() : ''
  if (reply) return reply
  const s = secondaryZh?.trim()
  if (s) return s
  return finalFallbackZh
}
