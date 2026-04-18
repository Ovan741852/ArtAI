import type { ServerEnv } from '../config/env.js'
import {
  MODEL_BUNDLE_ASSISTANT_REPLY_FALLBACK_EN,
  resolveAssistantReplyZh,
} from '../lib/assistantLlmUserReply.js'
import { coerceLlmStringList } from '../lib/coerceLlmStringList.js'
import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import type { CivitaiModelRow } from './civitaiModelRowMap.js'
import { mergeHotCivitaiModelsByTagsAndQueries } from './civitaiSuggestModelsFromDescriptions.js'
import {
  parseAssistantResourceExtrasFromLlm,
  resolveAssistantResourceExtras,
} from './assistantResourceExtras.js'
import type { AssistantResourceExtraResolved } from './assistantResourceExtrasTypes.js'
import { ollamaGenerateNonStream, ollamaGenerateStreamCollect } from './ollamaGenerate.js'
import { parseOllamaVisionImagesFromBody } from './ollamaVisionImagesFromBody.js'

export type ModelBundleAssistantRole = 'user' | 'assistant'

export type ModelBundleAssistantMessage = {
  role: ModelBundleAssistantRole
  content: string
}

export type ModelBundleAssistantBody = {
  messages: ModelBundleAssistantMessage[]
  ollamaModel?: string
  /** 每個 slot（checkpoint 或單一 LoRA）回傳的 Civitai 筆數上限，預設 4。 */
  recommendLimitPerSlot?: number
  perSearchLimit?: number
  nsfw?: boolean
  /**
   * 單張參考圖 base64（可含 `data:image/...;base64,` 前綴）。與本輪最後一則 user 一併送 Ollama；需使用**支援視覺**的模型。
   * 解碼後上限 8MB。
   */
  imageBase64?: string
  /** 多張參考圖；與 `imageBase64` 併用時順序為 `[單張, ...陣列]`。 */
  imageBase64s?: string[]
}

/** LLM 產出之單一搜尋 slot（僅 tags／queries，尚無 Civitai 結果）。 */
export type ModelBundleSlotSpec = {
  modelTags: string[]
  searchQueries: string[]
}

export type ModelBundleSpec = {
  titleZh: string
  noteZh: string | undefined
  checkpoint: ModelBundleSlotSpec
  loras: ModelBundleSlotSpec[]
}

export type ModelBundleResolvedSlot = ModelBundleSlotSpec & {
  recommendedModels: CivitaiModelRow[]
}

export type ModelBundleResolved = {
  titleZh: string
  noteZh: string | undefined
  checkpoint: ModelBundleResolvedSlot
  loras: ModelBundleResolvedSlot[]
}

export type ModelBundleAssistantResult = {
  ollamaModel: string
  imageAttached: boolean
  attachedImageCount: number
  assistant: {
    replyZh: string
  }
  bundles: ModelBundleResolved[]
  /** ControlNet／Embedding 說明或額外 LoRA 主題；Civitai 可查種類會附搜尋結果。 */
  resourceExtras: AssistantResourceExtraResolved[]
}

export type PreparedModelBundleAssistantTurn = {
  ollamaModel: string
  imageAttached: boolean
  imageB64s: string[]
  prompt: string
  recommendLimitPerSlot: number
  perSearchLimit: number
  nsfw: boolean
}

const MAX_MESSAGES = 24
const MAX_CONTENT_LEN = 8000

const MAX_BUNDLES = 3
const MIN_BUNDLES = 1
const MAX_TAGS_PER_SLOT = 4
const MAX_QUERIES_PER_SLOT = 2
const MAX_LORAS_PER_BUNDLE = 2

function readNonEmptyString(x: unknown, field: string): string {
  if (typeof x !== 'string' || !x.trim()) {
    throw new AppHttpError(502, `LLM JSON: "${field}" must be a non-empty string`)
  }
  return x.trim()
}

function readOptionalTrimmedString(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined
  const t = x.trim()
  return t ? t : undefined
}

function normalizeMessages(raw: unknown, allowLastUserEmptyWithImage: boolean): ModelBundleAssistantMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppHttpError(400, 'Body field "messages" must be a non-empty array')
  }
  if (raw.length > MAX_MESSAGES) {
    throw new AppHttpError(400, `At most ${String(MAX_MESSAGES)} messages allowed`)
  }
  const lastIdx = raw.length - 1
  const out: ModelBundleAssistantMessage[] = []
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
    throw new AppHttpError(
      400,
      'Last user message must not be empty unless at least one reference image is provided (imageBase64 / imageBase64s)',
    )
  }
  return out
}

function formatTranscript(messages: ModelBundleAssistantMessage[], attachedImageCount: number): string {
  return messages
    .map((m, idx) => {
      const label = m.role === 'user' ? 'User' : 'Assistant'
      const isLast = idx === messages.length - 1
      const n = attachedImageCount
      const placeholder =
        n <= 0
          ? ''
          : n === 1
            ? '[A reference image is attached for this user turn (no text).]'
            : `[${String(n)} reference images are attached for this user turn (no text).]`
      const text =
        m.role === 'user' && isLast && n > 0 && !m.content.trim() ? placeholder : m.content
      return `${label}:\n${text}`
    })
    .join('\n\n---\n\n')
}

function parseSlotSpec(raw: unknown, path: string): ModelBundleSlotSpec {
  if (raw == null || typeof raw !== 'object') {
    throw new AppHttpError(502, `LLM JSON: "${path}" must be an object`)
  }
  const o = raw as Record<string, unknown>
  const modelTags = coerceLlmStringList(o.modelTags, MAX_TAGS_PER_SLOT)
  const searchQueries = coerceLlmStringList(o.searchQueries, MAX_QUERIES_PER_SLOT)
  return { modelTags, searchQueries }
}

function parseBundleSpec(raw: unknown, index: number): ModelBundleSpec {
  if (raw == null || typeof raw !== 'object') {
    throw new AppHttpError(502, `LLM JSON: bundles[${String(index)}] must be an object`)
  }
  const o = raw as Record<string, unknown>
  const titleZh = readNonEmptyString(o.titleZh, `bundles[${String(index)}].titleZh`)
  const noteZh = readOptionalTrimmedString(o.noteZh)
  const checkpoint = parseSlotSpec(o.checkpoint, `bundles[${String(index)}].checkpoint`)
  if (checkpoint.modelTags.length === 0 && checkpoint.searchQueries.length === 0) {
    throw new AppHttpError(502, `LLM JSON: bundles[${String(index)}].checkpoint needs modelTags and/or searchQueries`)
  }
  let lorasRaw = o.loras
  if (lorasRaw != null && !Array.isArray(lorasRaw)) {
    throw new AppHttpError(502, `LLM JSON: bundles[${String(index)}].loras must be an array`)
  }
  const lorasIn = Array.isArray(lorasRaw) ? lorasRaw : []
  const loras: ModelBundleSlotSpec[] = []
  for (let j = 0; j < lorasIn.length && j < MAX_LORAS_PER_BUNDLE; j++) {
    const slot = parseSlotSpec(lorasIn[j], `bundles[${String(index)}].loras[${String(j)}]`)
    if (slot.modelTags.length === 0 && slot.searchQueries.length === 0) continue
    loras.push(slot)
  }
  if (loras.length === 0) {
    const tags = checkpoint.modelTags.slice(0, MAX_TAGS_PER_SLOT)
    const searches: string[] = []
    for (const q of checkpoint.searchQueries) {
      const t = q.trim()
      if (t) searches.push(t.toLowerCase().includes('lora') ? t : `${t} lora`)
      if (searches.length >= MAX_QUERIES_PER_SLOT) break
    }
    if (searches.length === 0 && checkpoint.modelTags[0]) {
      searches.push(`${checkpoint.modelTags[0]} lora`)
    }
    if (searches.length === 0) {
      searches.push('style lora')
    }
    loras.push({
      modelTags: tags.length > 0 ? [...tags] : ['character'],
      searchQueries: searches.slice(0, MAX_QUERIES_PER_SLOT),
    })
  }
  return { titleZh, noteZh, checkpoint, loras }
}

function parseBundlesFromLlm(o: Record<string, unknown>): ModelBundleSpec[] {
  const raw = o.bundles
  if (!Array.isArray(raw)) {
    throw new AppHttpError(502, 'LLM JSON: "bundles" must be an array')
  }
  if (raw.length < MIN_BUNDLES || raw.length > MAX_BUNDLES) {
    throw new AppHttpError(502, `LLM JSON: "bundles" must have length ${String(MIN_BUNDLES)}-${String(MAX_BUNDLES)}`)
  }
  return raw.map((item, i) => parseBundleSpec(item, i))
}

export async function prepareModelBundleAssistantTurn(
  env: ServerEnv,
  body: ModelBundleAssistantBody,
): Promise<PreparedModelBundleAssistantTurn> {
  const { imagesBase64: imageB64s } = parseOllamaVisionImagesFromBody(body as Record<string, unknown>)
  const imageAttached = imageB64s.length > 0
  const messages = normalizeMessages(body.messages, imageAttached)

  const ollamaModel = body.ollamaModel?.trim() || env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(
      400,
      'Ollama model is required: pass "ollamaModel" in JSON or set env OLLAMA_SUMMARY_MODEL',
    )
  }

  const recommendLimitPerSlot = Math.min(12, Math.max(1, Math.floor(body.recommendLimitPerSlot ?? 4)))
  const perSearchLimit = Math.min(100, Math.max(1, Math.floor(body.perSearchLimit ?? 12)))
  const nsfw = body.nsfw === false ? false : true

  const nImg = imageB64s.length
  const visionNote =
    nImg > 0
      ? [
          nImg === 1
            ? 'A REFERENCE IMAGE is attached for the latest user turn (via the vision API).'
            : `${String(nImg)} REFERENCE IMAGES are attached for the latest user turn (via the vision API).`,
          'Infer style, subject, and medium cues to propose Civitai discovery tags/queries in English.',
          '',
        ].join('\n')
      : ''

  const prompt = [
    'You help users build SMALL "download shopping lists" for Stable Diffusion on Civitai: one base Checkpoint plus optional LoRAs per bundle.',
    'The user may write in Traditional Chinese, English, or mixed language.',
    visionNote,
    'Conversation so far (newest at the end):',
    formatTranscript(messages, nImg),
    '',
    'Task: respond to the LATEST user message (and attached images if any). Output ONE JSON object only, no markdown, no commentary.',
    'JSON must be strict RFC 8259: no trailing commas, no markdown code fences, no text before the opening {.',
    'Keys exactly:',
    '- "replyZh": optional short user-visible line (any language; zh-TW OK). Max ~120 characters; friendly next step, no long tutorials. If empty, the server uses the first bundle title.',
    '- "bundles": array length 1-3. Each bundle is ONE alternative stack the user could download.',
    '  Each bundle object keys:',
    '  - "titleZh": short Traditional Chinese label for this stack (e.g. route A/B).',
    '  - "noteZh": optional one short Traditional Chinese sentence clarifying when to pick this stack.',
    '  - "checkpoint": object with "modelTags" (1-4 strings) and "searchQueries" (0-2 strings) — English only, for Civitai MODEL tag search and name search.',
    '  - "loras": array length **1-2** (required). Each element same shape as checkpoint (English modelTags 1-4, searchQueries 0-2). At least one modelTag OR searchQuery per LoRA slot.',
    '  - First LoRA: style / medium / composition (e.g. cel shading, photorealistic skin, lineart). Second LoRA (if any): character, object, or detail (e.g. eyes, fabric). Use Civitai-friendly English tags.',
    'Rules:',
    '- modelTags must be plausible Civitai MODEL tags in English (broad style/subject), not made-up commercial filenames.',
    '- Prefer distinct bundles when the user goal can be met multiple ways (e.g. anime vs semi-real).',
    '- Every bundle MUST list LoRAs that complement the checkpoint; do not return an empty "loras" array.',
    '- "resourceExtras": optional array length 0-6 for items that do not fit inside bundles but must appear to the user (e.g. ControlNet workflow tip, negative embedding tip, extra LoRA theme).',
    '  Same shape as checkpoint tag assistant: kind (lora | textual_inversion | controlnet | workflow), titleZh, detailZh?, modelTags?, searchQueries?; for lora/textual_inversion include English tags or queries for Civitai.',
  ].join('\n')

  return {
    ollamaModel,
    imageAttached,
    imageB64s,
    prompt,
    recommendLimitPerSlot,
    perSearchLimit,
    nsfw,
  }
}

async function resolveSlot(
  env: ServerEnv,
  prep: PreparedModelBundleAssistantTurn,
  spec: ModelBundleSlotSpec,
  types: 'Checkpoint' | 'LORA',
): Promise<ModelBundleResolvedSlot> {
  const recommendedModels =
    spec.modelTags.length === 0 && spec.searchQueries.length === 0
      ? []
      : await mergeHotCivitaiModelsByTagsAndQueries(env, {
          modelTags: spec.modelTags,
          searchQueries: spec.searchQueries,
          perSearchLimit: prep.perSearchLimit,
          resultLimit: prep.recommendLimitPerSlot,
          types,
          nsfw: prep.nsfw,
        })
  return {
    modelTags: spec.modelTags,
    searchQueries: spec.searchQueries,
    recommendedModels,
  }
}

export async function completeModelBundleAssistantFromLlmRaw(
  raw: string,
  env: ServerEnv,
  prep: PreparedModelBundleAssistantTurn,
): Promise<ModelBundleAssistantResult> {
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
  const specs = parseBundlesFromLlm(o)
  const replyZh = resolveAssistantReplyZh({
    replyRaw: o.replyZh,
    secondaryLine: specs[0]?.titleZh,
    finalFallback: MODEL_BUNDLE_ASSISTANT_REPLY_FALLBACK_EN,
  })

  const bundles: ModelBundleResolved[] = []
  for (const spec of specs) {
    const checkpoint = await resolveSlot(env, prep, spec.checkpoint, 'Checkpoint')
    const loras: ModelBundleResolvedSlot[] = []
    for (const l of spec.loras) {
      loras.push(await resolveSlot(env, prep, l, 'LORA'))
    }
    bundles.push({
      titleZh: spec.titleZh,
      noteZh: spec.noteZh,
      checkpoint,
      loras,
    })
  }

  const extraSpecs = parseAssistantResourceExtrasFromLlm(o)
  const resourceExtras = await resolveAssistantResourceExtras(env, extraSpecs, {
    perSearchLimit: prep.perSearchLimit,
    resultLimit: Math.min(4, prep.recommendLimitPerSlot),
    nsfw: prep.nsfw,
  })

  return {
    ollamaModel: prep.ollamaModel,
    imageAttached: prep.imageAttached,
    attachedImageCount: prep.imageB64s.length,
    assistant: { replyZh },
    bundles,
    resourceExtras,
  }
}

export async function writeModelBundleAssistantChatStream(
  env: ServerEnv,
  body: ModelBundleAssistantBody,
  writeLine: (obj: unknown) => Promise<void>,
  opts?: { signal?: AbortSignal; prep?: PreparedModelBundleAssistantTurn },
): Promise<void> {
  const prep = opts?.prep ?? (await prepareModelBundleAssistantTurn(env, body))

  const raw = await ollamaGenerateStreamCollect({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: prep.ollamaModel,
    prompt: prep.prompt,
    format: 'json',
    images: prep.imageB64s.length > 0 ? prep.imageB64s : undefined,
    signal: opts?.signal,
    onToken: async (chunk) => {
      await writeLine({ type: 'delta', text: chunk })
    },
  })

  const result = await completeModelBundleAssistantFromLlmRaw(raw, env, prep)

  await writeLine({
    type: 'final',
    ok: true,
    ...result,
  })
}

export async function runModelBundleAssistantChat(
  env: ServerEnv,
  body: ModelBundleAssistantBody,
): Promise<ModelBundleAssistantResult> {
  const prep = await prepareModelBundleAssistantTurn(env, body)

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: prep.ollamaModel,
    prompt: prep.prompt,
    format: 'json',
    images: prep.imageB64s.length > 0 ? prep.imageB64s : undefined,
  })

  return completeModelBundleAssistantFromLlmRaw(raw, env, prep)
}
