import { randomUUID } from 'node:crypto'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import {
  formatCreativeLoopTranscript,
  normalizeMessagesCreativeLoop,
  type CreativeLoopMessage,
} from './creativeLoopChat.js'
import { getLocalModelsDump } from './localModelsDump.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'
import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import { getWorkflowTemplateById } from './workflowTemplatesRegistry.js'

export type ResourceChecklistItemKind = 'checkpoint' | 'lora' | 'vae' | 'other'

export type CreativeLoopResourceChecklistItem = {
  id: string
  kind: ResourceChecklistItemKind
  titleZh: string
  filename: string | null
  modelTags: string[]
  searchQueries: string[]
  detailZh?: string
  /** 本機 Comfy checkpoint 清單可判定者為 true；LoRA／VAE 本階段無清單，一律 false，請使用者自行勾選確認。 */
  hasLocal: boolean
  browseUrl: string
}

export type CreativeLoopResourceCheckResult = {
  ollamaModel: string
  resolvedTemplateId: string
  replyZh: string
  checklist: CreativeLoopResourceChecklistItem[]
  localCheckpoints: string[]
  noteZh: string
}

const MAX_ITEMS = 12
const MAX_TAGS = 6
const MAX_QUERIES = 3

function readStringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue
    out.push(x.trim().slice(0, 200))
    if (out.length >= max) break
  }
  return out
}

function parseKind(raw: unknown): ResourceChecklistItemKind {
  if (raw === 'checkpoint') return 'checkpoint'
  if (raw === 'lora') return 'lora'
  if (raw === 'vae') return 'vae'
  return 'other'
}

function buildBrowseUrl(civitaiBase: string, tags: string[], queries: string[]): string {
  const base = civitaiBase.replace(/\/+$/, '')
  const q =
    tags.find((t) => t.trim())?.trim() ??
    queries.find((s) => s.trim())?.trim() ??
    'style'
  return `${base}/models?query=${encodeURIComponent(q)}`
}

function parseResolvedTemplateId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppHttpError(400, 'Body field "resolvedTemplateId" is required')
  }
  const t = raw.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(t)) {
    throw new AppHttpError(400, 'resolvedTemplateId must be a lowercase id')
  }
  return t
}

function parseProposedPatch(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppHttpError(400, 'Body field "proposedPatch" must be an object')
  }
  return { ...(raw as Record<string, unknown>) }
}

function readNonEmptyString(x: unknown, field: string): string {
  if (typeof x !== 'string' || !x.trim()) {
    throw new AppHttpError(502, `LLM JSON: "${field}" must be a non-empty string`)
  }
  return x.trim()
}

export async function runCreativeLoopResourceCheck(
  env: ServerEnv,
  bodyRaw: unknown,
): Promise<CreativeLoopResourceCheckResult> {
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    throw new AppHttpError(400, 'Expected a JSON object body')
  }
  const body = bodyRaw as Record<string, unknown>
  const messages: CreativeLoopMessage[] = normalizeMessagesCreativeLoop(body.messages)
  const resolvedTemplateId = parseResolvedTemplateId(body.resolvedTemplateId)
  const proposedPatch = parseProposedPatch(body.proposedPatch)
  const ollamaModel =
    typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(400, 'Ollama model is required or set OLLAMA_SUMMARY_MODEL')
  }

  const templateDoc = await getWorkflowTemplateById(resolvedTemplateId)
  if (!templateDoc) {
    throw new AppHttpError(404, `Unknown workflow template: "${resolvedTemplateId}"`)
  }

  const dump = await getLocalModelsDump(env, { force: false })
  const localCheckpoints = [...dump.sources.comfyui.checkpoints]
  const ckptSet = new Set(localCheckpoints)

  const whitelistKeys = Object.keys(templateDoc.whitelistParams).sort()

  const prompt = [
    'You output a RESOURCE checklist for a local ComfyUI user before they run image generation.',
    'The user reads Traditional Chinese; your "replyZh" and each item "titleZh" / "detailZh" MUST be Traditional Chinese.',
    'Use English only inside "modelTags" and "searchQueries" (for Civitai search).',
    '',
    'SELECTED workflow template id:',
    resolvedTemplateId,
    'Whitelist keys (AI may only suggest resources aligned with these):',
    JSON.stringify(whitelistKeys),
    '',
    'Current proposedPatch from the planning assistant (JSON):',
    JSON.stringify(proposedPatch, null, 0),
    '',
    'LOCAL ComfyUI checkpoint filenames (exact strings for checkpoint kind when listing a checkpoint file):',
    JSON.stringify(localCheckpoints, null, 0),
    '',
    'Conversation (newest at the end):',
    formatCreativeLoopTranscript(messages),
    '',
    'Task: list concrete resources the user needs to install or verify for THIS generation plan.',
    'Output ONE JSON object only, no markdown.',
    'Keys exactly:',
    '- "replyZh": Traditional Chinese short intro (what the checklist is for).',
    '- "items": array, length 1 to ' +
      String(MAX_ITEMS) +
      '. Each element:',
    '  - "kind": one of "checkpoint" | "lora" | "vae" | "other".',
    '  - "titleZh": short Traditional Chinese label.',
    '  - "filename": optional string — for kind "checkpoint" prefer an EXACT filename from the LOCAL list when possible; otherwise best guess .safetensors name.',
    '  - "modelTags": 0-' +
      String(MAX_TAGS) +
      ' English strings for Civitai.',
    '  - "searchQueries": 0-' +
      String(MAX_QUERIES) +
      ' English search phrases.',
    '  - "detailZh": optional Traditional Chinese one-line note.',
    'Include the main checkpoint from proposedPatch if present; add LoRA/VAE only if the plan clearly needs them.',
  ].join('\n')

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: ollamaModel,
    prompt,
    format: 'json',
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
  const itemsRaw = o.items
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    throw new AppHttpError(502, 'LLM JSON: "items" must be a non-empty array')
  }

  const checklist: CreativeLoopResourceChecklistItem[] = []
  for (let i = 0; i < Math.min(itemsRaw.length, MAX_ITEMS); i++) {
    const row = itemsRaw[i]
    if (row == null || typeof row !== 'object' || Array.isArray(row)) continue
    const r = row as Record<string, unknown>
    const kind = parseKind(r.kind)
    const titleZh =
      typeof r.titleZh === 'string' && r.titleZh.trim() ? r.titleZh.trim().slice(0, 400) : `項目 ${String(i + 1)}`
    const filename =
      typeof r.filename === 'string' && r.filename.trim() ? r.filename.trim().slice(0, 400) : null
    const modelTags = readStringList(r.modelTags, MAX_TAGS)
    const searchQueries = readStringList(r.searchQueries, MAX_QUERIES)
    const detailZh =
      typeof r.detailZh === 'string' && r.detailZh.trim() ? r.detailZh.trim().slice(0, 600) : undefined

    let hasLocal = false
    if (kind === 'checkpoint' && filename && ckptSet.has(filename)) {
      hasLocal = true
    }

    checklist.push({
      id: randomUUID(),
      kind,
      titleZh,
      filename,
      modelTags,
      searchQueries,
      detailZh,
      hasLocal,
      browseUrl: buildBrowseUrl(env.civitaiBaseUrl, modelTags, searchQueries),
    })
  }

  if (checklist.length === 0) {
    throw new AppHttpError(502, 'LLM returned no valid checklist items')
  }

  const noteZh =
    'LoRA、VAE 等項目目前無法由伺服器自動比對本機檔案；若顯示「本機未安裝」請自行確認後勾選。Checkpoint 會比對 Comfy 回報的 checkpoint 檔名。'

  return {
    ollamaModel,
    resolvedTemplateId,
    replyZh,
    checklist,
    localCheckpoints,
    noteZh,
  }
}
