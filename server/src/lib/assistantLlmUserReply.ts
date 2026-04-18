/**
 * User-visible one-line reply from LLM JSON (`replyZh` key is historical; any language OK).
 * Returns "" when missing or not a string.
 */
export function readOptionalAssistantReplyLine(x: unknown): string {
  if (typeof x !== 'string') return ''
  return x.trim()
}

/** When the model omits a reply, derive a short English line from discovery fields. */
export function fallbackReplyFromDiscoveryTags(modelTags: string[], searchQueries: string[]): string {
  const parts = [...modelTags, ...searchQueries].filter(Boolean)
  if (parts.length > 0) {
    return `Suggestions: ${parts.slice(0, 12).join(', ')}.`
  }
  return 'See recommended checkpoints and resources below.'
}
