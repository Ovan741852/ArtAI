import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { fetchCheckpointList } from './comfyuiCheckpoints.js'
import { readCharacterImageFile } from './characterLibraryAssets.js'
import { runComfyPromptToFirstPngBuffer } from './comfyPromptExecution.js'
import { findCharacterById, readCharacterLibraryIndex, type CharacterRecord } from './characterLibraryStore.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'
import { runWorkflowTemplateOnComfy } from './workflowTemplateRun.js'

const TEMPLATE_ID = 'basic-txt2img'
const DEFAULT_DENOISE = 0.58
const DEFAULT_NEGATIVE = 'worst quality, low quality, blurry, bad anatomy, deformed'
const ALLOWED_SCHEDULERS = new Set([
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
  'linear_quadratic',
  'kl_optimal',
])

type AiPlan = {
  checkpoint?: string
  reasonZh?: string
  promptAppendEn?: string
  negativeAppendEn?: string
  steps?: number
  cfg?: number
  width?: number
  height?: number
  denoise?: number
  sampler_name?: string
  scheduler?: string
  seed?: number
}

function pickOllamaModel(env: ServerEnv, raw?: string): string {
  const t = raw?.trim()
  return t && t !== '' ? t : env.ollamaSummaryModel
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647)
}

function asNum(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function clampFloat(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function cleanTail(raw: string | undefined, maxLen: number): string {
  if (!raw) return ''
  const s = raw.trim().replace(/\s+/g, ' ')
  return s.slice(0, maxLen)
}

function normalizeScheduler(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  return ALLOWED_SCHEDULERS.has(t) ? t : null
}

function buildFallbackPositive(params: {
  userPrompt: string
  summaryZh: string | null
  profileEn: Record<string, unknown> | null
}): string {
  let profilePrefix = ''
  if (params.profileEn && Object.keys(params.profileEn).length > 0) {
    try {
      profilePrefix = JSON.stringify(params.profileEn)
    } catch {
      profilePrefix = ''
    }
    if (profilePrefix.length > 1200) profilePrefix = `${profilePrefix.slice(0, 1200)}…`
  }
  const parts = [
    params.userPrompt.trim(),
    params.summaryZh ? `Character note (zh): ${params.summaryZh.trim()}` : '',
    profilePrefix ? `Character profile (JSON, English keys): ${profilePrefix}` : '',
    'masterpiece, best quality, highly detailed',
  ]
  return parts.filter(Boolean).join(', ').slice(0, 2800)
}

async function expandPositiveWithOllama(params: {
  env: ServerEnv
  model: string
  userPrompt: string
  summaryZh: string | null
  profileEn: Record<string, unknown> | null
}): Promise<string> {
  const profileStr =
    params.profileEn && Object.keys(params.profileEn).length > 0
      ? JSON.stringify(params.profileEn).slice(0, 2000)
      : '(none)'
  const summary = params.summaryZh?.trim() || '(none)'
  const prompt = [
    'Write ONE English-only positive prompt for Stable Diffusion 1.5.',
    'Comma-separated tags and short phrases. No markdown, no JSON, no surrounding quotes.',
    'Max 900 characters.',
    'Incorporate the user request and character hints naturally.',
    '',
    `User request (may be Traditional Chinese or English): ${params.userPrompt.trim()}`,
    '',
    `Character summary (Traditional Chinese, may be empty): ${summary}`,
    '',
    `Character profile JSON (English keys, may be empty): ${profileStr}`,
  ].join('\n')

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: params.env.ollamaBaseUrl,
    model: params.model,
    prompt,
  })
  const s = raw
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/^```[\s\S]*?```$/m, (m) => m.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''))
    .trim()
    .slice(0, 2800)
  if (!s) {
    throw new Error('Ollama returned empty prompt')
  }
  return s
}

async function planGenerationWithAi(params: {
  env: ServerEnv
  model: string
  userPrompt: string
  summaryZh: string | null
  profileEn: Record<string, unknown> | null
  feedbackZh: string | null
  checkpoints: string[]
  forcedCheckpoint?: string
  previousCheckpoint?: string
}): Promise<AiPlan | null> {
  const profileStr =
    params.profileEn && Object.keys(params.profileEn).length > 0
      ? JSON.stringify(params.profileEn).slice(0, 2000)
      : '(none)'
  const checkpoints = JSON.stringify(params.checkpoints.slice(0, 120), null, 0)
  const forced = params.forcedCheckpoint ? params.forcedCheckpoint.trim() : ''
  const prompt = [
    'You are a Stable Diffusion generation planner.',
    'Output ONE JSON object only (no markdown).',
    'Choose a checkpoint and optional parameter tweaks based on the user goal and feedback.',
    'If forcedCheckpoint is provided, you MUST keep that checkpoint value unchanged.',
    'All descriptions in the JSON should be concise.',
    '',
    'JSON keys allowed:',
    '{"checkpoint":string,"reasonZh":string,"promptAppendEn":string,"negativeAppendEn":string,"steps":number,"cfg":number,"width":number,"height":number,"denoise":number,"sampler_name":string,"scheduler":string,"seed":number}',
    '',
    `forcedCheckpoint: ${forced || '(none)'}`,
    `previousCheckpoint: ${params.previousCheckpoint || '(none)'}`,
    `userPrompt: ${params.userPrompt}`,
    `feedbackZh: ${params.feedbackZh || '(none)'}`,
    `characterSummaryZh: ${params.summaryZh || '(none)'}`,
    `characterProfileJson: ${profileStr}`,
    '',
    `availableCheckpoints: ${checkpoints}`,
    '',
    'Rules:',
    '- checkpoint must be one of availableCheckpoints.',
    '- reasonZh should be Traditional Chinese, one short sentence.',
    '- promptAppendEn and negativeAppendEn should be short English additions.',
    '- Keep numeric values practical for SD1.5.',
  ].join('\n')

  let raw: string
  try {
    raw = await ollamaGenerateNonStream({
      ollamaBaseUrl: params.env.ollamaBaseUrl,
      model: params.model,
      prompt,
      format: 'json',
    })
  } catch {
    return null
  }

  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }
  const o = data as Record<string, unknown>
  const out: AiPlan = {}
  if (typeof o.checkpoint === 'string' && o.checkpoint.trim()) out.checkpoint = o.checkpoint.trim()
  if (typeof o.reasonZh === 'string') out.reasonZh = o.reasonZh.trim().slice(0, 160)
  if (typeof o.promptAppendEn === 'string') out.promptAppendEn = cleanTail(o.promptAppendEn, 260)
  if (typeof o.negativeAppendEn === 'string') out.negativeAppendEn = cleanTail(o.negativeAppendEn, 260)
  if (typeof o.sampler_name === 'string') out.sampler_name = o.sampler_name.trim().slice(0, 64)
  if (typeof o.scheduler === 'string') out.scheduler = o.scheduler.trim().slice(0, 64)
  const steps = asNum(o.steps)
  if (steps != null) out.steps = clampInt(steps, 1, 150)
  const cfg = asNum(o.cfg)
  if (cfg != null) out.cfg = clampFloat(cfg, 1, 30)
  const width = asNum(o.width)
  if (width != null) out.width = clampInt(width, 64, 4096)
  const height = asNum(o.height)
  if (height != null) out.height = clampInt(height, 64, 4096)
  const denoise = asNum(o.denoise)
  if (denoise != null) out.denoise = clampFloat(denoise, 0, 1)
  const seed = asNum(o.seed)
  if (seed != null) out.seed = clampInt(seed, 0, 2_147_483_647)
  return out
}

export async function runCharacterTxt2imgFromLibrary(params: {
  env: ServerEnv
  characterId: string
  body: unknown
}): Promise<{
  imagePngBase64: string
  patchApply: { ok: true; appliedKeys: string[]; ignoredKeys: string[] }
  positiveFinalEn: string
  negativeUsed: string
  checkpointUsed: string
  ollamaExpansionUsed: boolean
  checkpointDecisionZh: string
  feedbackApplied: boolean
  messageZh: string
}> {
  const index = await readCharacterLibraryIndex(params.env)
  const ch = findCharacterById(index, params.characterId)
  if (!ch) {
    throw new AppHttpError(404, 'Character not found')
  }

  const rec =
    params.body != null && typeof params.body === 'object' && !Array.isArray(params.body)
      ? (params.body as Record<string, unknown>)
      : {}

  const userPrompt = rec.prompt
  if (typeof userPrompt !== 'string' || !userPrompt.trim()) {
    throw new AppHttpError(400, 'Body field "prompt" is required (non-empty string)')
  }

  const useExpansion = rec.useOllamaExpansion !== false
  const ollamaModel = pickOllamaModel(params.env, typeof rec.ollamaModel === 'string' ? rec.ollamaModel : undefined)
  const profileEn = ch.profile?.profileEn ?? null
  const summaryZh = ch.profile?.summaryZh ?? null
  const feedbackZh =
    typeof rec.feedbackZh === 'string' && rec.feedbackZh.trim() ? rec.feedbackZh.trim().slice(0, 600) : null
  const identityModeRaw = typeof rec.identityMode === 'string' ? rec.identityMode.trim() : ''
  const identityMode = identityModeRaw === 'text_only' ? 'text_only' : 'anchor_img2img'

  let positiveFinal: string
  let ollamaExpansionUsed = false
  if (useExpansion) {
    try {
      positiveFinal = await expandPositiveWithOllama({
        env: params.env,
        model: ollamaModel,
        userPrompt: userPrompt.trim(),
        summaryZh,
        profileEn,
      })
      ollamaExpansionUsed = true
    } catch {
      positiveFinal = buildFallbackPositive({
        userPrompt: userPrompt.trim(),
        summaryZh,
        profileEn,
      })
    }
  } else {
    positiveFinal = buildFallbackPositive({
      userPrompt: userPrompt.trim(),
      summaryZh,
      profileEn,
    })
  }

  let checkpoints: string[]
  try {
    checkpoints = await fetchCheckpointList(params.env.comfyuiBaseUrl)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Cannot list ComfyUI checkpoints: ${msg}`)
  }
  if (!checkpoints.length) {
    throw new AppHttpError(502, 'No checkpoints found in ComfyUI; please install one in ComfyUI')
  }

  const ckptRaw = typeof rec.checkpoint === 'string' ? rec.checkpoint.trim() : ''
  const autoCheckpoint = rec.autoCheckpointByAi !== false
  const needAiPlanning = autoCheckpoint || feedbackZh != null
  let aiPlan: AiPlan | null = null
  if (needAiPlanning) {
    aiPlan = await planGenerationWithAi({
      env: params.env,
      model: ollamaModel,
      userPrompt: userPrompt.trim(),
      summaryZh,
      profileEn,
      feedbackZh,
      checkpoints,
      forcedCheckpoint: ckptRaw || undefined,
      previousCheckpoint: typeof rec.previousCheckpointUsed === 'string' ? rec.previousCheckpointUsed : undefined,
    })
  }

  let ckpt = checkpoints[0]
  let checkpointDecisionZh = '未指定 checkpoint，使用本機清單第一個。'
  if (ckptRaw) {
    if (!checkpoints.includes(ckptRaw)) {
      throw new AppHttpError(400, `Unknown checkpoint: "${ckptRaw}" (not found in ComfyUI models/checkpoints)`)
    }
    ckpt = ckptRaw
    checkpointDecisionZh = '使用者指定 checkpoint。'
  } else if (autoCheckpoint && aiPlan?.checkpoint && checkpoints.includes(aiPlan.checkpoint)) {
    ckpt = aiPlan.checkpoint
    checkpointDecisionZh = aiPlan.reasonZh || '由 AI 依角色與提示詞挑選 checkpoint。'
  } else if (autoCheckpoint) {
    checkpointDecisionZh = 'AI 未提供可用 checkpoint，改用本機清單第一個。'
  }

  let negative =
    typeof rec.negative === 'string' && rec.negative.trim()
      ? rec.negative.trim()
      : DEFAULT_NEGATIVE
  if (aiPlan?.negativeAppendEn) {
    negative = `${negative}, ${aiPlan.negativeAppendEn}`.slice(0, 2800)
  }

  let steps = typeof rec.steps === 'number' && Number.isFinite(rec.steps) ? Math.floor(rec.steps) : 24
  let cfg = typeof rec.cfg === 'number' && Number.isFinite(rec.cfg) ? rec.cfg : 7.5
  let width = typeof rec.width === 'number' && Number.isFinite(rec.width) ? Math.floor(rec.width) : 512
  let height = typeof rec.height === 'number' && Number.isFinite(rec.height) ? Math.floor(rec.height) : 512
  if (aiPlan?.steps != null && rec.steps == null) steps = aiPlan.steps
  if (aiPlan?.cfg != null && rec.cfg == null) cfg = aiPlan.cfg
  if (aiPlan?.width != null && rec.width == null) width = aiPlan.width
  if (aiPlan?.height != null && rec.height == null) height = aiPlan.height

  let seed =
    typeof rec.seed === 'number' && Number.isFinite(rec.seed)
      ? Math.floor(rec.seed)
      : aiPlan?.seed != null
        ? aiPlan.seed
        : randomSeed()
  if (seed < 0) seed = randomSeed()

  let timeoutMs: number | undefined
  if (rec.timeoutMs != null) {
    if (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs)) {
      throw new AppHttpError(400, 'timeoutMs must be a finite number when provided')
    }
    const n = Math.floor(rec.timeoutMs)
    if (n < 10_000 || n > 1_800_000) {
      throw new AppHttpError(400, 'timeoutMs must be between 10000 and 1800000')
    }
    timeoutMs = n
  }

  const patch: Record<string, unknown> = {
    ckpt_name: ckpt,
    positive: positiveFinal,
    negative,
    steps,
    cfg,
    width,
    height,
    seed,
    filename_prefix: `ArtAI-char-${params.characterId.replace(/-/g, '').slice(0, 10)}`,
  }

  if (typeof rec.sampler_name === 'string' && rec.sampler_name.trim()) {
    patch.sampler_name = rec.sampler_name.trim()
  } else if (aiPlan?.sampler_name) {
    patch.sampler_name = aiPlan.sampler_name
  }
  const userScheduler = normalizeScheduler(rec.scheduler)
  const aiScheduler = normalizeScheduler(aiPlan?.scheduler)
  if (userScheduler) {
    patch.scheduler = userScheduler
  } else if (aiScheduler) {
    patch.scheduler = aiScheduler
  } else if (Object.prototype.hasOwnProperty.call(patch, 'scheduler')) {
    patch.scheduler = 'normal'
  }
  if (aiPlan?.promptAppendEn) {
    patch.positive = `${String(patch.positive)}, ${aiPlan.promptAppendEn}`.slice(0, 2800)
  }

  const result =
    identityMode === 'anchor_img2img'
      ? await runAnchorImg2imgOnComfy({
          env: params.env,
          ch,
          patch,
          timeoutMs,
          denoiseRaw: rec.denoise ?? aiPlan?.denoise,
        })
      : await runWorkflowTemplateOnComfy(params.env, TEMPLATE_ID, {
          patch,
          timeoutMs,
        })

  const feedbackApplied = feedbackZh != null && aiPlan != null
  const messageZh = ollamaExpansionUsed
    ? identityMode === 'anchor_img2img'
      ? '已用 Ollama 整理提示詞，並以角色錨點圖走 img2img 鎖定外觀後由 Comfy 產圖。'
      : '已用 Ollama 將角色摘要／profile 與你的描述合併成英文提示詞，並由 Comfy 產圖。'
    : identityMode === 'anchor_img2img'
      ? '已用角色資料備援提示詞，並以錨點圖走 img2img 鎖定外觀後由 Comfy 產圖。'
      : '已將角色資料與你的描述直接串成提示詞，並由 Comfy 產圖（或 Ollama 擴寫失敗時之備援）。'

  return {
    imagePngBase64: result.imagePngBase64,
    patchApply: result.patchApply,
    positiveFinalEn: positiveFinal,
    negativeUsed: negative,
    checkpointUsed: ckpt,
    ollamaExpansionUsed,
    checkpointDecisionZh,
    feedbackApplied,
    messageZh,
  }
}

async function comfyUploadImage(params: {
  comfyuiBaseUrl: string
  buffer: Buffer
  mime: string
  filename: string
}): Promise<string> {
  const base = params.comfyuiBaseUrl.replace(/\/+$/, '')
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(params.buffer)], { type: params.mime }), params.filename)
  form.append('type', 'input')
  form.append('overwrite', 'true')

  const res = await fetch(`${base}/upload/image`, {
    method: 'POST',
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ComfyUI upload ${String(res.status)}: ${text.slice(0, 240)}`)
  }
  let data: unknown
  try {
    data = JSON.parse(text) as unknown
  } catch {
    throw new Error('ComfyUI /upload/image: response is not JSON')
  }
  if (data == null || typeof data !== 'object') {
    throw new Error('ComfyUI /upload/image: expected object')
  }
  const name = (data as Record<string, unknown>).name
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('ComfyUI /upload/image: missing "name"')
  }
  return name.trim()
}

function parseDenoise(raw: unknown): number {
  if (raw == null) return DEFAULT_DENOISE
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new AppHttpError(400, 'denoise must be a finite number when provided')
  }
  const n = Math.max(0, Math.min(1, raw))
  return n
}

async function runAnchorImg2imgOnComfy(params: {
  env: ServerEnv
  ch: CharacterRecord
  patch: Record<string, unknown>
  timeoutMs?: number
  denoiseRaw: unknown
}): Promise<{ imagePngBase64: string; patchApply: { ok: true; appliedKeys: string[]; ignoredKeys: string[] } }> {
  if (params.ch.images.length === 0) {
    throw new AppHttpError(400, 'Character has no anchor image')
  }
  const anchor = params.ch.images[0]
  const anchorFile = await readCharacterImageFile(params.env, anchor.relPath)
  const uploadedName = await comfyUploadImage({
    comfyuiBaseUrl: params.env.comfyuiBaseUrl,
    buffer: anchorFile.buffer,
    mime: anchorFile.mime,
    filename: `anchor_${params.ch.id}.png`,
  })

  const ckpt = String(params.patch.ckpt_name ?? '')
  const positive = String(params.patch.positive ?? '')
  const negative = String(params.patch.negative ?? '')
  const steps = Number(params.patch.steps ?? 24)
  const cfg = Number(params.patch.cfg ?? 7.5)
  const seed = Number(params.patch.seed ?? randomSeed())
  const denoise = parseDenoise(params.denoiseRaw)
  const filenamePrefix = String(params.patch.filename_prefix ?? `ArtAI-char-${params.ch.id.slice(0, 8)}`)
  const samplerName = typeof params.patch.sampler_name === 'string' ? params.patch.sampler_name : 'euler'
  const scheduler = typeof params.patch.scheduler === 'string' ? params.patch.scheduler : 'normal'

  const prompt: Record<string, unknown> = {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: uploadedName },
    },
    '2': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positive, clip: ['2', 1] },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['2', 1] },
    },
    '5': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['1', 0], vae: ['2', 2] },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        denoise,
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['2', 2] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: filenamePrefix, images: ['7', 0] },
    },
  }

  let buf: Buffer
  try {
    buf = await runComfyPromptToFirstPngBuffer({
      comfyuiBaseUrl: params.env.comfyuiBaseUrl,
      prompt,
      timeoutMs: params.timeoutMs,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Comfy img2img generation failed: ${msg}`)
  }

  return {
    imagePngBase64: buf.toString('base64'),
    patchApply: { ok: true, appliedKeys: Object.keys(params.patch), ignoredKeys: [] },
  }
}
