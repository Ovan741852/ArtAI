import { randomUUID } from 'node:crypto'

const DEFAULT_COMFY_TIMEOUT_MS = 180_000
const POLL_MS = 400

function comfyBase(comfyuiBaseUrl: string): string {
  return comfyuiBaseUrl.replace(/\/+$/, '')
}

type PromptPostOk = {
  prompt_id?: string
  error?: { message?: string }
  node_errors?: unknown
}

export async function comfyPostPrompt(base: string, prompt: Record<string, unknown>): Promise<string> {
  const clientId = randomUUID()
  const res = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ prompt, client_id: clientId }),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text) as unknown
  } catch {
    throw new Error(`ComfyUI /prompt: non-JSON (${String(res.status)})`)
  }
  if (!res.ok) {
    const snippet = text.slice(0, 400)
    throw new Error(`ComfyUI /prompt ${String(res.status)}: ${snippet}`)
  }
  const obj = data as PromptPostOk
  if (obj.error) {
    const m = typeof obj.error.message === 'string' ? obj.error.message : JSON.stringify(obj.error)
    throw new Error(`ComfyUI /prompt rejected: ${m}`)
  }
  const pid = obj.prompt_id
  if (typeof pid !== 'string' || !pid) {
    throw new Error('ComfyUI /prompt: missing prompt_id')
  }
  return pid
}

export function extractFirstOutputImage(
  historyEntry: unknown,
): { filename: string; subfolder: string; type: string } | null {
  if (historyEntry == null || typeof historyEntry !== 'object') return null
  const outputs = (historyEntry as Record<string, unknown>).outputs
  if (outputs == null || typeof outputs !== 'object') return null
  for (const nodeOut of Object.values(outputs as Record<string, unknown>)) {
    if (nodeOut == null || typeof nodeOut !== 'object') continue
    const images = (nodeOut as Record<string, unknown>).images
    if (!Array.isArray(images) || images.length === 0) continue
    const first = images[0]
    if (first == null || typeof first !== 'object') continue
    const rec = first as Record<string, unknown>
    const fn = rec.filename
    if (typeof fn !== 'string' || !fn) continue
    const subfolder = typeof rec.subfolder === 'string' ? rec.subfolder : ''
    const type = typeof rec.type === 'string' ? rec.type : 'output'
    return { filename: fn, subfolder, type }
  }
  return null
}

function extractExecutionErrorFromMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  for (const item of messages) {
    if (!Array.isArray(item) || item.length < 2) continue
    const kind = item[0]
    if (kind !== 'execution_error' && kind !== 'execution_interrupted') continue
    const payload = item[1]
    if (payload != null && typeof payload === 'object') {
      const ex = (payload as Record<string, unknown>).exception_message
      if (typeof ex === 'string' && ex.trim()) return ex.trim().slice(0, 2000)
      const nodeType = (payload as Record<string, unknown>).node_type
      const errType = (payload as Record<string, unknown>).exception_type
      const bits = [typeof nodeType === 'string' ? nodeType : '', typeof errType === 'string' ? errType : '']
        .filter(Boolean)
        .join(' ')
      if (bits) return bits.slice(0, 2000)
    }
  }
  return null
}

export function readHistoryExecutionError(historyEntry: unknown): string | null {
  if (historyEntry == null || typeof historyEntry !== 'object') return null
  const status = (historyEntry as Record<string, unknown>).status
  if (status == null || typeof status !== 'object') return null
  const st = status as Record<string, unknown>
  const fromMessages = extractExecutionErrorFromMessages(st.messages)
  if (fromMessages) return fromMessages
  const statusStr = st.status_str
  if (statusStr === 'error') {
    const messages = st.messages
    if (!Array.isArray(messages)) return 'ComfyUI execution error'
    try {
      return JSON.stringify(messages).slice(0, 1200)
    } catch {
      return 'ComfyUI execution error'
    }
  }
  return null
}

export async function comfyFetchHistoryEntry(base: string, promptId: string): Promise<unknown | null> {
  const res = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) return null
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ComfyUI /history ${String(res.status)}: ${text.slice(0, 200)}`)
  }
  let data: unknown
  try {
    data = JSON.parse(text) as unknown
  } catch {
    throw new Error('ComfyUI /history: response is not JSON')
  }
  if (data == null || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  return root[promptId] ?? null
}

export async function comfyFetchViewPng(
  base: string,
  meta: { filename: string; subfolder: string; type: string },
): Promise<Buffer> {
  const sp = new URLSearchParams({
    filename: meta.filename,
    type: meta.type,
    subfolder: meta.subfolder,
  })
  const res = await fetch(`${base}/view?${sp.toString()}`)
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200)
    throw new Error(`ComfyUI /view ${String(res.status)}: ${t}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 送出 Comfy `prompt` 並輪詢直到取得第一張輸出 PNG（或逾時／執行錯誤）。
 */
export async function runComfyPromptToFirstPngBuffer(params: {
  comfyuiBaseUrl: string
  prompt: Record<string, unknown>
  timeoutMs?: number
}): Promise<Buffer> {
  const base = comfyBase(params.comfyuiBaseUrl)
  const timeoutMs = params.timeoutMs ?? DEFAULT_COMFY_TIMEOUT_MS
  const promptId = await comfyPostPrompt(base, params.prompt)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const entry = await comfyFetchHistoryEntry(base, promptId)
    if (entry != null) {
      const errMsg = readHistoryExecutionError(entry)
      if (errMsg) {
        throw new Error(errMsg)
      }
      const imgMeta = extractFirstOutputImage(entry)
      if (imgMeta) {
        return await comfyFetchViewPng(base, imgMeta)
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }

  throw new Error(`ComfyUI timed out after ${String(timeoutMs)} ms`)
}
