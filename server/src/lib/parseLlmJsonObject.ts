/**
 * 從 LLM 回覆中取出單一 JSON 物件（允許前綴說明、```json 圍欄與尾端雜訊）。
 */
export function parseJsonObjectFromLlm(text: string): unknown {
  let t = text.trim()
  const fenceStart = t.indexOf('```')
  if (fenceStart !== -1) {
    let inner = t.slice(fenceStart + 3)
    inner = inner.replace(/^json\s*/i, '').trimStart()
    const close = inner.indexOf('```')
    if (close !== -1) inner = inner.slice(0, close)
    t = inner.trim()
  }

  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('LLM output does not contain a JSON object')
  }

  return JSON.parse(t.slice(start, end + 1)) as unknown
}
