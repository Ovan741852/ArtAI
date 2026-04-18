/**
 * LLM JSON 常把「字串列表」回成單一字串、逗號分隔、或混到數字；收斂為 trimmed string[]（最多 max 個）。
 */
export function coerceLlmStringList(x: unknown, max: number): string[] {
  const cap = Math.max(0, Math.floor(max))
  if (cap === 0) return []

  if (x === undefined || x === null) return []

  if (Array.isArray(x)) {
    const out: string[] = []
    for (const el of x) {
      let s: string
      if (typeof el === 'string') s = el.trim()
      else if (typeof el === 'number' && Number.isFinite(el)) s = String(el).trim()
      else continue
      if (!s) continue
      out.push(s)
      if (out.length >= cap) break
    }
    return out
  }

  if (typeof x === 'string') {
    const raw = x.trim()
    if (!raw) return []
    const parts = raw
      .split(/[,;|\n]+/)
      .map((p) => p.trim())
      .filter(Boolean)
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of parts) {
      const k = p.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
      if (out.length >= cap) break
    }
    return out.length > 0 ? out : [raw].slice(0, cap)
  }

  if (typeof x === 'number' && Number.isFinite(x)) {
    const s = String(x).trim()
    return s ? [s] : []
  }

  return []
}
