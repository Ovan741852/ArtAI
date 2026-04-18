import type { ServerEnv } from '../config/env.js'
import {
  CHECKPOINT_TAG_DISCOVERY_FALLBACK_EN,
  fallbackReplyFromDiscoveryTags,
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
import { getLocalModelsDump } from './localModelsDump.js'
import { ollamaGenerateNonStream, ollamaGenerateStreamCollect } from './ollamaGenerate.js'
import { parseOllamaVisionImagesFromBody } from './ollamaVisionImagesFromBody.js'

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
  /**
   * 多張參考圖；規則同 `imageBase64`。與 `imageBase64` 併用時順序為 `[單張, ...陣列]`；總張數上限見伺服器常數。
   */
  imageBase64s?: string[]
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
  /** 本請求實際送入 Ollama 的參考圖張數（0 表示無）。 */
  attachedImageCount: number
  localCheckpoints: LocalCheckpointForAssistant[]
  assistant: {
    replyZh: string
    modelTags: string[]
    searchQueries: string[]
  }
  recommendedModels: CivitaiModelRow[]
  /** LoRA／Embedding／ControlNet 等條列；含 Civitai 可查之推薦（lora、textual_inversion）。 */
  resourceExtras: AssistantResourceExtraResolved[]
}

export type PreparedCheckpointTagAssistantTurn = {
  ollamaModel: string
  imageAttached: boolean
  imageB64s: string[]
  prompt: string
  localCheckpoints: LocalCheckpointForAssistant[]
  recommendLimit: number
  perSearchLimit: number
  nsfw: boolean
}

const MAX_MESSAGES = 24
const MAX_CONTENT_LEN = 8000

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
    throw new AppHttpError(
      400,
      'Last user message must not be empty unless at least one reference image is provided (imageBase64 / imageBase64s)',
    )
  }
  return out
}

function formatTranscript(messages: CheckpointTagAssistantMessage[], attachedImageCount: number): string {
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

/**
 * 驗證 body、讀 dump、組 prompt（供一般 JSON 與 NDJSON 串流共用）。
 */
export async function prepareCheckpointTagAssistantTurn(
  env: ServerEnv,
  body: CheckpointTagAssistantBody,
): Promise<PreparedCheckpointTagAssistantTurn> {
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

  const nImg = imageB64s.length
  const visionNote =
    nImg > 0
      ? [
          nImg === 1
            ? 'A REFERENCE IMAGE is attached for the latest user turn (via the vision API).'
            : `${String(nImg)} REFERENCE IMAGES are attached for the latest user turn (via the vision API).`,
          'Infer visual style, subject, lighting, medium (photo vs illustration vs 3D), and genre cues relevant to Stable Diffusion checkpoint discovery.',
          'Use the images together with any user text and the local checkpoint list.',
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
    formatTranscript(messages, nImg),
    '',
    'Task: respond to the LATEST user message (and attached images if any). Output ONE JSON object only, no markdown, no commentary.',
    'Keys exactly:',
    '- "replyZh": optional short user-visible line (any language; Traditional Chinese OK). Max ~220 characters; next step + tone; do NOT paste long tutorials. If unsure, use "" and rely on modelTags/searchQueries.',
    '- "modelTags": 1-6 strings — plausible Civitai MODEL tags in English for CHECKPOINT discovery (e.g. anime, photorealistic, fantasy, architecture, portrait).',
    '- "searchQueries": 0-4 short English keyword phrases for Civitai Checkpoint name search when tags alone may miss.',
    '- "resourceExtras": array length 0-6. Each item explains ONE resource row the user should see (same content you would have put in a long reply).',
    '  Each item: "kind" (one of: lora | textual_inversion | controlnet | workflow), "titleZh" (short Traditional Chinese heading), optional "detailZh" (1-3 short sentences, Traditional Chinese).',
    '  For kind lora or textual_inversion you MUST also set "modelTags" (1-4 English Civitai model tags) and/or "searchQueries" (0-2 English phrases) so the server can query Civitai (types LORA or TextualInversion). Example LoRA tags: app design, flat design, vector, lineart.',
    '  For controlnet or workflow use detailZh only; modelTags/searchQueries may be empty.',
    'If you mention UI mockups, design LoRAs, negative embeddings, or ControlNet, you MUST represent them as separate resourceExtras rows (do not hide them only inside replyZh).',
    'Do not invent specific commercial model names as tags; prefer broad style/subject tags.',
  ].join('\n')

  return {
    ollamaModel,
    imageAttached,
    imageB64s,
    prompt,
    localCheckpoints,
    recommendLimit,
    perSearchLimit,
    nsfw,
  }
}

export async function completeCheckpointTagAssistantFromLlmRaw(
  raw: string,
  env: ServerEnv,
  prep: PreparedCheckpointTagAssistantTurn,
): Promise<{
  assistant: CheckpointTagAssistantResult['assistant']
  recommendedModels: CivitaiModelRow[]
  resourceExtras: AssistantResourceExtraResolved[]
}> {
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
  const modelTags = coerceLlmStringList(o.modelTags, 6)
  const searchQueries = coerceLlmStringList(o.searchQueries, 4)
  const replyZh = resolveAssistantReplyZh({
    replyRaw: o.replyZh,
    tertiaryLine: fallbackReplyFromDiscoveryTags(modelTags, searchQueries),
    finalFallback: CHECKPOINT_TAG_DISCOVERY_FALLBACK_EN,
  })

  let recommendedModels: CivitaiModelRow[] = []
  if (modelTags.length > 0 || searchQueries.length > 0) {
    recommendedModels = await mergeHotCivitaiModelsByTagsAndQueries(env, {
      modelTags,
      searchQueries,
      perSearchLimit: prep.perSearchLimit,
      resultLimit: prep.recommendLimit,
      types: 'Checkpoint',
      nsfw: prep.nsfw,
    })
  }

  const extraSpecs = parseAssistantResourceExtrasFromLlm(o)
  const extraLimit = Math.min(4, prep.recommendLimit)
  const resourceExtras = await resolveAssistantResourceExtras(env, extraSpecs, {
    perSearchLimit: prep.perSearchLimit,
    resultLimit: extraLimit,
    nsfw: prep.nsfw,
  })

  return {
    assistant: { replyZh, modelTags, searchQueries },
    recommendedModels,
    resourceExtras,
  }
}

/**
 * 串流 NDJSON：每行一個 JSON；`delta` 為 Ollama token；最後一行 `final` 含完整結果（與非串流 JSON 對齊）。
 * 若已在外層呼叫 `prepareCheckpointTagAssistantTurn`，可傳 `prep` 避免重複讀 dump。
 */
export async function writeCheckpointTagAssistantChatStream(
  env: ServerEnv,
  body: CheckpointTagAssistantBody,
  writeLine: (obj: unknown) => Promise<void>,
  opts?: { signal?: AbortSignal; prep?: PreparedCheckpointTagAssistantTurn },
): Promise<void> {
  const prep = opts?.prep ?? (await prepareCheckpointTagAssistantTurn(env, body))

  const raw = await ollamaGenerateStreamCollect({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: prep.ollamaModel,
    prompt: prep.prompt,
    images: prep.imageB64s.length > 0 ? prep.imageB64s : undefined,
    signal: opts?.signal,
    onToken: async (chunk) => {
      await writeLine({ type: 'delta', text: chunk })
    },
  })

  const { assistant, recommendedModels, resourceExtras } = await completeCheckpointTagAssistantFromLlmRaw(raw, env, prep)

  await writeLine({
    type: 'final',
    ok: true,
    ollamaModel: prep.ollamaModel,
    imageAttached: prep.imageAttached,
    attachedImageCount: prep.imageB64s.length,
    localCheckpoints: prep.localCheckpoints,
    assistant,
    recommendedModels,
    resourceExtras,
  })
}

export async function runCheckpointTagAssistantChat(
  env: ServerEnv,
  body: CheckpointTagAssistantBody,
): Promise<CheckpointTagAssistantResult> {
  const prep = await prepareCheckpointTagAssistantTurn(env, body)

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: prep.ollamaModel,
    prompt: prep.prompt,
    images: prep.imageB64s.length > 0 ? prep.imageB64s : undefined,
  })

  const { assistant, recommendedModels, resourceExtras } = await completeCheckpointTagAssistantFromLlmRaw(raw, env, prep)

  return {
    ollamaModel: prep.ollamaModel,
    imageAttached: prep.imageAttached,
    attachedImageCount: prep.imageB64s.length,
    localCheckpoints: prep.localCheckpoints,
    assistant,
    recommendedModels,
    resourceExtras,
  }
}
