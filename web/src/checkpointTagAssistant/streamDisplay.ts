/**
 * Split streaming assistant text into "closed sentences" vs tail still typing.
 * Uses common CJK / Latin sentence enders plus paragraph breaks.
 */
export function splitStreamForDisplay(raw: string): { closed: string; open: string } {
  const s = raw
  if (!s) return { closed: '', open: '' }

  let lastEnd = -1
  const re = /[。！？…．!?](?:\s|$)|\.(?:\s+|$)|\n{2,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    lastEnd = m.index + m[0].length
  }

  if (lastEnd < 0) return { closed: '', open: s }
  return { closed: s.slice(0, lastEnd), open: s.slice(lastEnd) }
}
