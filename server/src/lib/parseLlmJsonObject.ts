/**
 * 部分模型會在「字串外」寫成 `{\"key\": \"value\"}`（把 `\"` 當成引號），合法 JSON 應為 `{"key": "value"}`。
 * 在雙引號字串**外**，若見 `\\` 後接 `"`，則略過反斜線只保留 `"` 並進入字串狀態。
 */
function stripErroneousBackslashBeforeQuoteOutsideStrings(input: string): string {
  const out: string[] = []
  let i = 0
  let inStr = false
  let esc = false
  while (i < input.length) {
    const c = input[i]!
    if (esc) {
      out.push(c)
      esc = false
      i += 1
      continue
    }
    if (inStr) {
      if (c === '\\') {
        out.push(c)
        esc = true
        i += 1
        continue
      }
      if (c === '"') {
        out.push(c)
        inStr = false
        i += 1
        continue
      }
      out.push(c)
      i += 1
      continue
    }
    if (c === '\\' && input[i + 1] === '"') {
      out.push('"')
      inStr = true
      i += 2
      continue
    }
    if (c === '"') {
      out.push(c)
      inStr = true
      i += 1
      continue
    }
    out.push(c)
    i += 1
  }
  return out.join('')
}

/**
 * 移除 JSON 中「物件／陣列尾端多餘的逗號」（僅在字串外），不處理單引號或其它語法。
 * LLM 常產出 `{"a":[1,],}` 或 `{"a":1,}` 導致 `JSON.parse` 失敗。
 */
function stripTrailingCommasOutsideStrings(input: string): string {
  const out: string[] = []
  let i = 0
  let inStr = false
  let esc = false
  while (i < input.length) {
    const c = input[i]!
    if (esc) {
      out.push(c)
      esc = false
      i += 1
      continue
    }
    if (inStr) {
      if (c === '\\') {
        out.push(c)
        esc = true
        i += 1
        continue
      }
      if (c === '"') {
        out.push(c)
        inStr = false
        i += 1
        continue
      }
      out.push(c)
      i += 1
      continue
    }
    if (c === '"') {
      out.push(c)
      inStr = true
      i += 1
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j]!)) j += 1
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        i = j
        continue
      }
    }
    out.push(c)
    i += 1
  }
  return out.join('')
}

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

  const slice = t.slice(start, end + 1)
  const repaired = stripTrailingCommasOutsideStrings(stripErroneousBackslashBeforeQuoteOutsideStrings(slice))
  try {
    return JSON.parse(slice) as unknown
  } catch (e1) {
    try {
      return JSON.parse(repaired) as unknown
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1)
      const m2 = e2 instanceof Error ? e2.message : String(e2)
      throw new Error(`${m1} (after LLM JSON repair: ${m2})`)
    }
  }
}
