import { Buffer } from 'node:buffer'
import type { ServerEnv } from '../config/env.js'
import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import type { CivitaiModelRow } from './civitaiModelRowMap.js'
import { mergeHotCivitaiModelsByTagsAndQueries } from './civitaiSuggestModelsFromDescriptions.js'
import { getLocalModelsDump } from './localModelsDump.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'

export type CheckpointTagAssistantRole = 'user' | 'assistant'

export type CheckpointTagAssistantMessage = {
  role: CheckpointTagAssistantRole
  content: string
}

export type CheckpointTagAssistantBody = {
  messages: CheckpointTagAssistantMessage[]
  ollamaModel?: string
  /** Civitai 推薦筆數上限，預設 5。 */
  recommendLimit?: number
  perSearchLimit?: number
  nsfw?: boolean
  /**
   * 單張參考圖 base64（可含 `data:image/...;base64,` 前綴）。與本輪最後一則 user 一併送 Ollama；需使用**支援視覺**的模型。
   * 解碼後上限 8MB。
   */
  imageBase64?: string
}

export type LocalCheckpointForAssistant = {
  localFilename: string
  civitaiTags: string[]
  civitaiModelName: string | null
  inCatalog: boolean
}

export type CheckpointTagAssistantResult = {
  ollamaModel: string
  /** 本請求是否附上圖片並走 Ollama `images` 欄位。 */
  imageAttached: boolean
  localCheckpoints: LocalCheckpointForAssistant[]
  assistant: {
    replyZh: string
    modelTags: string[]
    searchQueries: string[]
  }
  recommendedModels: CivitaiModelRow[]
}

const MAX_MESSAGES = 24
const MAX_CONTENT_LEN = 8000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function parseOptionalImageBase64(raw: unknown): string | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'string') return undefined
  let s = raw.trim()
  if (!s) return undefined
  const dataUrl = /^data:image\/[^;]+;base64,(.+)$/is.exec(s)
  if (dataUrl) s = dataUrl[1].replace(/\s/g, '')
  else s = s.replace(/\s/g, '')
  try {
    const buf = Buffer.from(s, 'base64')
    if (buf.byteLength === 0) {
      throw new AppHttpError(400, 'imageBase64 decodes to empty')
    }
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new AppHttpError(400, 'imageBase64 too large (max 8 MB after decode)')
    }
  } catch (e) {
    if (e instanceof AppHttpError) throw e
    throw new AppHttpError(400, 'imageBase64 is not valid base64')
  }
  return s
}

function readStringList(x: unknown, field: string, max: number): string[] {
  if (x === undefined || x === null) return []
  if (!Array.isArray(x)) throw new AppHttpError(502, `LLM JSON: "${field}" must be an array or omitted`)
  const out: string[] = []
  for (const el of x) {
    if (typeof el !== 'string') continue
    const t = el.trim()
    if (t) out.push(t)
    if (out.length >= max) break
  }
  return out
}

function readNonEmptyString(x: unknown, field: string): string {
  if (typeof x !== 'string' || !x.trim()) {
    throw new AppHttpError(502, `LLM JSON: "${field}" must be a non-empty string`)
  }
  return x.trim()
}

function normalizeMessages(raw: unknown, allowLastUserEmptyWithImage: boolean): CheckpointTagAssistantMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppHttpError(400, 'Body field "messages" must be a non-empty array')
  }
  if (raw.length > MAX_MESSAGES) {
    throw new AppHttpError(400, `At most ${String(MAX_MESSAGES)} messages allowed`)
  }
  const lastIdx = raw.length - 1
  const out: CheckpointTagAssistantMessage[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (row == null || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const role = o.role
    const content = o.content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    const trimmed = content.trim().slice(0, MAX_CONTENT_LEN)
    if (!trimmed) {
      if (role === 'user' && allowLastUserEmptyWithImage && i === lastIdx) {
        out.push({ role: 'user', content: '' })
      }
      continue
    }
    out.push({ role, content: trimmed })
  }
  if (out.length === 0) {
    throw new AppHttpError(400, 'No valid messages (need role user|assistant and non-empty content)')
  }
  if (out[out.length - 1]?.role !== 'user') {
    throw new AppHttpError(400, 'Last message must be from role "user"')
  }
  const last = out[out.length - 1]
  if (!last.content.trim() && !allowLastUserEmptyWithImage) {
    throw new AppHttpError(400, 'Last user message must not be empty unless imageBase64 is provided')
  }
  return out
}

function formatTranscript(messages: CheckpointTagAssistantMessage[], imageAttached: boolean): string {
  return messages
    .map((m, idx) => {
      const label = m.role === 'user' ? 'User' : 'Assistant'
      const isLast = idx === messages.length - 1
      const text =
        m.role === 'user' && isLast && imageAttached && !m.content.trim()
          ? '[A reference image is attached for this user turn (no text).]'
          : m.content
      return `${label}:\n${text}`
    })
    .join('\n\n---\n\n')
}

export async function runCheckpointTagAssistantChat(
  env: ServerEnv,
  body: CheckpointTagAssistantBody,
): Promise<CheckpointTagAssistantResult> {
  const imageB64 = parseOptionalImageBase64((body as Record<string, unknown>).imageBase64)
  const imageAttached = Boolean(imageB64)
  const messages = normalizeMessages(body.messages, imageAttached)

  const ollamaModel = body.ollamaModel?.trim() || env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(
      400,
      'Ollama model is required: pass "ollamaModel" in JSON or set env OLLAMA_SUMMARY_MODEL',
    )
  }

  const recommendLimit = Math.min(12, Math.max(1, Math.floor(body.recommendLimit ?? 5)))
  const perSearchLimit = Math.min(100, Math.max(1, Math.floor(body.perSearchLimit ?? 12)))
  const nsfw = body.nsfw === false ? false : true

  const dump = await getLocalModelsDump(env, { force: false })
  const catalogByFile = new Map(dump.sources.checkpointCatalog.entries.map((e) => [e.localFilename, e]))

  const localCheckpoints: LocalCheckpointForAssistant[] = []
  for (const fn of dump.sources.comfyui.checkpoints) {
    const cat = catalogByFile.get(fn)
    localCheckpoints.push({
      localFilename: fn,
      civitaiTags: cat ? [...cat.civitaiTags] : [],
      civitaiModelName: cat?.civitaiModelName ?? null,
      inCatalog: Boolean(cat),
    })
  }

  const localJson = JSON.stringify(localCheckpoints, null, 0)

  const visionNote = imageAttached
    ? [
        'A REFERENCE IMAGE is attached for the latest user turn (via the vision API).',
        'Infer visual style, subject, lighting, medium (photo vs illustration vs 3D), and genre cues relevant to Stable Diffusion checkpoint discovery.',
        'Use the image together with any user text and the local checkpoint list.',
        '',
      ].join('\n')
    : ''

  const prompt = [
    'You help users discover suitable Civitai checkpoint MODEL TAGS and short search queries for Stable Diffusion / ComfyUI.',
    'The user may write in Traditional Chinese, English, or mixed language.',
    visionNote,
    'LOCAL MACHINE checkpoints (ComfyUI filenames; civitaiTags come from a synced Civitai catalog and may be empty):',
    localJson,
    '',
    'Conversation so far (newest at the end):',
    formatTranscript(messages, imageAttached),
    '',
    'Task: respond to the LATEST user message (and attached image if any). Output ONE JSON object only, no markdown, no commentary.',
    'Keys exactly:',
    '- "replyZh": Traditional Chinese reply to the user (concise, friendly, actionable; suggest which local filenames might fit when relevant).',
    '- "modelTags": 1-6 strings — plausible Civitai MODEL tags in English (e.g. anime, photorealistic, fantasy, architecture, portrait).',
    '- "searchQueries": 0-4 short English keyword phrases for Civitai name search when tags alone may miss.',
    'Do not invent specific commercial model names as tags; prefer broad style/subject tags.',
  ].join('\n')

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: ollamaModel,
    prompt,
    images: imageB64 ? [imageB64] : undefined,
  })

  let parsed: unknown
  try {
    parsed = parseJsonObjectFromLlm(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Failed to parse LLM JSON: ${msg}`)
  }

  if (parsed == null || typeof parsed !== 'object') {
    throw new AppHttpError(502, 'LLM JSON: expected an object')
  }

  const o = parsed as Record<string, unknown>
  const replyZh = readNonEmptyString(o.replyZh, 'replyZh')
  const modelTags = readStringList(o.modelTags, 'modelTags', 6)
  const searchQueries = readStringList(o.searchQueries, 'searchQueries', 4)

  let recommendedModels: CivitaiModelRow[] = []
  if (modelTags.length > 0 || searchQueries.length > 0) {
    recommendedModels = await mergeHotCivitaiModelsByTagsAndQueries(env, {
      modelTags,
      searchQueries,
      perSearchLimit,
      resultLimit: recommendLimit,
      types: 'Checkpoint',
      nsfw,
    })
  }

  return {
    ollamaModel,
    imageAttached,
    localCheckpoints,
    assistant: { replyZh, modelTags, searchQueries },
    recommendedModels,
  }
}
