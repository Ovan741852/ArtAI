import type { ServerEnv } from '../config/env.js'
import { applyWorkflowTemplatePatch } from './applyWorkflowTemplatePatch.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { getComfyObjectInfoCached } from './comfyuiObjectInfo.js'
import { getLocalModelsDump } from './localModelsDump.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'
import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import {
  MAX_OLLAMA_VISION_IMAGES,
  parseOllamaVisionImagesFromBody,
} from './ollamaVisionImagesFromBody.js'
import type { WorkflowTemplateDoc, WorkflowTemplateListItem } from './workflowTemplatesRegistry.js'
import { getWorkflowTemplateById, listWorkflowTemplates } from './workflowTemplatesRegistry.js'

export type CreativeLoopMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type CreativeLoopChatBody = {
  messages: CreativeLoopMessage[]
  ollamaModel?: string
  /** 必填：此輪要套用的 workflow 模板 id。 */
  selectedTemplateId: string
  imageBase64?: string
  imageBase64s?: string[]
  /** 可選：上一張生成結果 PNG（無 data URL 前綴），供視覺模型對照；與參考圖合計仍受張數上限。 */
  lastOutputPngBase64?: string
}

export type CreativeLoopChatResult = {
  ollamaModel: string
  selectedTemplateId: string
  templateTitleZh: string
  localCheckpoints: string[]
  templates: WorkflowTemplateListItem[]
  objectInfoSummary:
    | { ok: true; nodeTypeCount: number; refreshedAt: string; fromCache: boolean }
    | { ok: false; message: string }
    | null
  attachedImageCount: number
  assistant: {
    replyZh: string
    understandingZh?: string
    proposedPatch: Record<string, unknown>
  }
  resolvedWorkflow: WorkflowTemplateDoc['workflow'] | null
  patchApply:
    | { ok: true; appliedKeys: string[]; ignoredKeys: string[] }
    | { ok: false; message: string }
    | null
}

const MAX_MESSAGES = 24
const MAX_CONTENT_LEN = 8000

function readNonEmptyString(x: unknown, field: string): string {
  if (typeof x !== 'string' || !x.trim()) {
    throw new AppHttpError(502, `LLM JSON: "${field}" must be a non-empty string`)
  }
  return x.trim()
}

function normalizeMessagesCreativeLoop(raw: unknown): CreativeLoopMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppHttpError(400, 'Body field "messages" must be a non-empty array')
  }
  if (raw.length > MAX_MESSAGES) {
    throw new AppHttpError(400, `At most ${String(MAX_MESSAGES)} messages allowed`)
  }
  const out: CreativeLoopMessage[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const role = o.role
    const content = o.content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    const trimmed = content.trim().slice(0, MAX_CONTENT_LEN)
    if (!trimmed) continue
    out.push({ role, content: trimmed })
  }
  if (out.length === 0) {
    throw new AppHttpError(400, 'No valid messages (need role user|assistant and non-empty content)')
  }
  if (out[out.length - 1]?.role !== 'user') {
    throw new AppHttpError(400, 'Last message must be from role "user"')
  }
  return out
}

function formatTranscript(messages: CreativeLoopMessage[]): string {
  return messages
    .map((m) => {
      const label = m.role === 'user' ? 'User' : 'Assistant'
      return `${label}:\n${m.content}`
    })
    .join('\n\n---\n\n')
}

function parseRequiredTemplateId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppHttpError(400, 'Body field "selectedTemplateId" is required')
  }
  const t = raw.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(t)) {
    throw new AppHttpError(400, 'selectedTemplateId must be a lowercase id (letters, digits, hyphen)')
  }
  return t
}

function filterPatchToWhitelist(
  template: WorkflowTemplateDoc,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (template.whitelistParams[k]) {
      out[k] = v
    }
  }
  return out
}

function parseOptionalLastOutput(body: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, 'lastOutputPngBase64')) {
    return null
  }
  const raw = body.lastOutputPngBase64
  if (raw == null) return null
  if (typeof raw !== 'string' || !raw.trim()) {
    return null
  }
  const { imagesBase64 } = parseOllamaVisionImagesFromBody({
    imageBase64: raw,
  })
  if (imagesBase64.length !== 1) {
    throw new AppHttpError(400, 'lastOutputPngBase64 must decode to exactly one image')
  }
  return imagesBase64[0] ?? null
}

/**
 * 參考圖 + 可選上一張成品；合計張數不超過 {@link MAX_OLLAMA_VISION_IMAGES}。
 */
export function buildCreativeLoopOllamaImages(body: Record<string, unknown>): {
  images: string[]
  attachedImageCount: number
  referenceImageCount: number
  hasLastOutputImage: boolean
} {
  const { imagesBase64: refs } = parseOllamaVisionImagesFromBody(body)
  const last = parseOptionalLastOutput(body)
  if (!last) {
    return {
      images: refs,
      attachedImageCount: refs.length,
      referenceImageCount: refs.length,
      hasLastOutputImage: false,
    }
  }
  if (refs.length >= MAX_OLLAMA_VISION_IMAGES) {
    throw new AppHttpError(
      400,
      '參考圖已達上限時無法再附上輪成品對照；請移除一張參考圖或不要附成品。',
    )
  }
  const merged = [...refs, last]
  return {
    images: merged,
    attachedImageCount: merged.length,
    referenceImageCount: refs.length,
    hasLastOutputImage: true,
  }
}

export async function runCreativeLoopChat(env: ServerEnv, bodyRaw: unknown): Promise<CreativeLoopChatResult> {
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    throw new AppHttpError(400, 'Expected a JSON object body')
  }
  const body = bodyRaw as Record<string, unknown>
  const messages = normalizeMessagesCreativeLoop(body.messages)
  const selectedTemplateId = parseRequiredTemplateId(body.selectedTemplateId)
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(
      400,
      'Ollama model is required: pass "ollamaModel" in JSON or set env OLLAMA_SUMMARY_MODEL',
    )
  }

  const templateDoc = await getWorkflowTemplateById(selectedTemplateId)
  if (!templateDoc) {
    throw new AppHttpError(404, `Unknown workflow template: "${selectedTemplateId}"`)
  }

  const {
    images: ollamaImages,
    attachedImageCount,
    referenceImageCount,
    hasLastOutputImage,
  } = buildCreativeLoopOllamaImages(body)

  const [dump, templates] = await Promise.all([getLocalModelsDump(env, { force: false }), listWorkflowTemplates()])

  const localCheckpoints = [...dump.sources.comfyui.checkpoints]

  let objectInfoSummary: CreativeLoopChatResult['objectInfoSummary'] = null
  try {
    const hit = await getComfyObjectInfoCached(env.comfyuiBaseUrl, env.comfyObjectInfoTtlMs, { force: false })
    objectInfoSummary = {
      ok: true,
      nodeTypeCount: hit.nodeTypeCount,
      refreshedAt: hit.refreshedAt,
      fromCache: hit.fromCache,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    objectInfoSummary = { ok: false, message }
  }

  const whitelistSummary = Object.fromEntries(
    Object.entries(templateDoc.whitelistParams).map(([k, spec]) => [
      k,
      { type: spec.type, descriptionEn: spec.descriptionEn ?? null },
    ]),
  )

  const prompt = [
    'You are an image-generation planning assistant for non-expert users.',
    'The user writes mainly in Traditional Chinese; you may reason in English internally.',
    'You MUST only propose changes via "proposedPatch" keys that exist in the whitelist for the SELECTED template.',
    'Do NOT use ComfyUI jargon in "replyZh" (no node ids); prefer plain Traditional Chinese: lighting, composition, style, realism, "closer to reference images", etc.',
    'When reference images are attached, use them to align subject, style, palette, and composition when helpful.',
    'When the last attached image is the previous generated output (server marks it LAST_OUTPUT in the prompt), compare it with reference images and the user request.',
    '',
    'SELECTED TEMPLATE (machine-readable):',
    JSON.stringify(
      {
        id: templateDoc.id,
        titleZh: templateDoc.titleZh,
        descriptionZh: templateDoc.descriptionZh,
        whitelistParams: whitelistSummary,
      },
      null,
      0,
    ),
    '',
    'LOCAL ComfyUI checkpoint filenames (pick one for ckpt_name if patch includes it):',
    JSON.stringify(localCheckpoints, null, 0),
    '',
    'ComfyUI object_info summary:',
    JSON.stringify(objectInfoSummary, null, 0),
    '',
    ollamaImages.length > 0
      ? [
          'Attached images order (for vision):',
          ...ollamaImages.map((_, i) => {
            const tag = hasLastOutputImage && i === referenceImageCount ? 'LAST_OUTPUT' : 'REFERENCE'
            return `- index ${String(i)}: ${tag}`
          }),
          '',
        ].join('\n')
      : '',
    'Conversation (newest at the end):',
    formatTranscript(messages),
    '',
    'Task: respond to the LATEST user message. Output ONE JSON object only, no markdown, no commentary.',
    'Keys exactly:',
    '- "replyZh": Traditional Chinese reply (concise, friendly, actionable).',
    '- "understandingZh": optional string — short restatement of what the user wants.',
    '- "proposedPatch": object — ONLY keys from the whitelist; values must match parameter types.',
  ].join('\n')

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: ollamaModel,
    prompt,
    images: ollamaImages.length > 0 ? ollamaImages : undefined,
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
  const understandingZh =
    typeof o.understandingZh === 'string' && o.understandingZh.trim()
      ? o.understandingZh.trim().slice(0, 1200)
      : undefined

  const proposedRaw = o.proposedPatch
  let proposedPatch: Record<string, unknown> =
    proposedRaw != null && typeof proposedRaw === 'object' && !Array.isArray(proposedRaw)
      ? { ...(proposedRaw as Record<string, unknown>) }
      : {}
  proposedPatch = filterPatchToWhitelist(templateDoc, proposedPatch)

  let resolvedWorkflow: WorkflowTemplateDoc['workflow'] | null = null
  let patchApply: CreativeLoopChatResult['patchApply'] = null

  const filtered = filterPatchToWhitelist(templateDoc, proposedPatch)
  const applied = applyWorkflowTemplatePatch(templateDoc, filtered)
  if (!applied.ok) {
    patchApply = { ok: false, message: applied.message }
  } else {
    resolvedWorkflow = applied.workflow
    patchApply = {
      ok: true,
      appliedKeys: applied.appliedKeys,
      ignoredKeys: applied.ignoredKeys,
    }
  }

  return {
    ollamaModel,
    selectedTemplateId,
    templateTitleZh: templateDoc.titleZh,
    localCheckpoints,
    templates,
    objectInfoSummary,
    attachedImageCount,
    assistant: {
      replyZh,
      understandingZh,
      proposedPatch,
    },
    resolvedWorkflow,
    patchApply,
  }
}
