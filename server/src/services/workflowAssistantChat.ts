import type { ServerEnv } from '../config/env.js'
import {
  readOptionalUnderstandingZh,
  resolveAssistantReplyZh,
  WORKFLOW_ASSISTANT_REPLY_FALLBACK_EN,
} from '../lib/assistantLlmUserReply.js'
import { coerceLlmStringList } from '../lib/coerceLlmStringList.js'
import { parseJsonObjectFromLlm } from '../lib/parseLlmJsonObject.js'
import { applyWorkflowTemplatePatch } from './applyWorkflowTemplatePatch.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { getComfyObjectInfoCached } from './comfyuiObjectInfo.js'
import { getLocalModelsDump } from './localModelsDump.js'
import { ollamaGenerateNonStream, ollamaGenerateStreamCollect } from './ollamaGenerate.js'
import type { WorkflowTemplateDoc, WorkflowTemplateListItem } from './workflowTemplatesRegistry.js'
import { getWorkflowTemplateById, listWorkflowTemplates } from './workflowTemplatesRegistry.js'

export type WorkflowAssistantRole = 'user' | 'assistant'

export type WorkflowAssistantMessage = {
  role: WorkflowAssistantRole
  content: string
}

export type WorkflowAssistantBody = {
  messages: WorkflowAssistantMessage[]
  ollamaModel?: string
  /** 已選模板時，助手可產出 `proposedPatch` 並套用為 `resolvedWorkflow`。 */
  selectedTemplateId?: string
  /** 建議本輪優先使用的 checkpoint 檔名（須存在於本機 Comfy 列表）。 */
  localCheckpoint?: string
}

export type WorkflowAssistantResult = {
  ollamaModel: string
  selectedTemplateId: string | null
  localCheckpoints: string[]
  templates: WorkflowTemplateListItem[]
  objectInfoSummary:
    | { ok: true; nodeTypeCount: number; refreshedAt: string; fromCache: boolean }
    | { ok: false; message: string }
    | null
  assistant: {
    replyZh: string
    understandingZh?: string
    confirmationOptionsZh: string[]
    intentEn: Record<string, string>
    proposedPatch: Record<string, unknown>
    suggestedTemplateId: string | null
  }
  resolvedWorkflow: WorkflowTemplateDoc['workflow'] | null
  patchApply:
    | { ok: true; appliedKeys: string[]; ignoredKeys: string[] }
    | { ok: false; message: string }
    | null
}

export type PreparedWorkflowAssistantTurn = {
  ollamaModel: string
  prompt: string
  selectedTemplateId: string | null
  templateDoc: WorkflowTemplateDoc | null
  localCheckpoints: string[]
  templates: WorkflowTemplateListItem[]
  objectInfoSummary: WorkflowAssistantResult['objectInfoSummary']
}

const MAX_MESSAGES = 24
const MAX_CONTENT_LEN = 8000

function normalizeMessages(raw: unknown): WorkflowAssistantMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppHttpError(400, 'Body field "messages" must be a non-empty array')
  }
  if (raw.length > MAX_MESSAGES) {
    throw new AppHttpError(400, `At most ${String(MAX_MESSAGES)} messages allowed`)
  }
  const out: WorkflowAssistantMessage[] = []
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

function formatTranscript(messages: WorkflowAssistantMessage[]): string {
  return messages
    .map((m) => {
      const label = m.role === 'user' ? 'User' : 'Assistant'
      return `${label}:\n${m.content}`
    })
    .join('\n\n---\n\n')
}

function parseOptionalTemplateId(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(t)) {
    throw new AppHttpError(400, 'selectedTemplateId must be a lowercase id (letters, digits, hyphen)')
  }
  return t
}

function parseIntentEn(raw: unknown): Record<string, string> {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(o)) {
    if (n >= 16) break
    if (!/^[a-z][a-z0-9_]{0,31}$/i.test(k)) continue
    if (typeof v === 'string' && v.trim()) {
      out[k] = v.trim().slice(0, 400)
      n++
    }
  }
  return out
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

export async function prepareWorkflowAssistantTurn(
  env: ServerEnv,
  body: WorkflowAssistantBody,
): Promise<PreparedWorkflowAssistantTurn> {
  const messages = normalizeMessages(body.messages)
  const ollamaModel = body.ollamaModel?.trim() || env.ollamaSummaryModel
  if (!ollamaModel) {
    throw new AppHttpError(
      400,
      'Ollama model is required: pass "ollamaModel" in JSON or set env OLLAMA_SUMMARY_MODEL',
    )
  }

  const selectedTemplateId = parseOptionalTemplateId(
    (body as Record<string, unknown>).selectedTemplateId,
  )
  let templateDoc: WorkflowTemplateDoc | null = null
  if (selectedTemplateId) {
    templateDoc = await getWorkflowTemplateById(selectedTemplateId)
    if (!templateDoc) {
      throw new AppHttpError(404, `Unknown workflow template: "${selectedTemplateId}"`)
    }
  }

  const [dump, templates] = await Promise.all([getLocalModelsDump(env, { force: false }), listWorkflowTemplates()])

  const localCheckpoints = [...dump.sources.comfyui.checkpoints]

  let objectInfoSummary: WorkflowAssistantResult['objectInfoSummary'] = null
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

  const templateSummaries = templates.map((t) => ({
    id: t.id,
    titleZh: t.titleZh,
    descriptionZh: t.descriptionZh,
    tags: t.tags,
    whitelistKeys: t.whitelistKeys,
  }))

  const localCkptHint =
    typeof body.localCheckpoint === 'string' && body.localCheckpoint.trim()
      ? body.localCheckpoint.trim()
      : null

  const templateDetail =
    templateDoc == null
      ? ''
      : [
          'CURRENTLY SELECTED TEMPLATE (machine-readable; apply patches only to whitelist keys):',
          JSON.stringify(
            {
              id: templateDoc.id,
              titleZh: templateDoc.titleZh,
              descriptionZh: templateDoc.descriptionZh,
              whitelistParams: templateDoc.whitelistParams,
            },
            null,
            0,
          ),
          '',
        ].join('\n')

  const prompt = [
    'You help non-expert users choose and tune ComfyUI workflows using ONLY predefined templates (whitelist parameters).',
    'The user may write in Traditional Chinese, English, or mixed language.',
    'You MUST NOT invent custom node graphs or node types outside the templates.',
    '',
    'AVAILABLE TEMPLATES (JSON array):',
    JSON.stringify(templateSummaries, null, 0),
    '',
    templateDetail,
    'LOCAL ComfyUI checkpoint filenames (may be empty if Comfy is offline):',
    JSON.stringify(localCheckpoints, null, 0),
    '',
    localCkptHint ? `User hint for checkpoint filename (prefer if compatible): "${localCkptHint}"\n` : '',
    'ComfyUI object_info summary (node type count; may be missing if Comfy unreachable):',
    JSON.stringify(objectInfoSummary, null, 0),
    '',
    'Conversation (newest at the end):',
    formatTranscript(messages),
    '',
    'Task: respond to the LATEST user message. Output ONE JSON object only, no markdown, no commentary.',
    'Keys exactly:',
    '- "replyZh": optional short user-visible line (any language; zh-TW OK). Concise, friendly, actionable. If empty, the server may use understandingZh or a generic fallback.',
    '- "understandingZh": optional string — short restatement of what you think the user wants.',
    '- "confirmationOptionsZh": 0-4 short Traditional Chinese lines the user can confirm (e.g. "你是想要更清晰？").',
    '- "intentEn": object with short English string values (0-12 keys) describing structured intent (e.g. sharper, faster, face_focus).',
    '- "proposedPatch": object — ONLY keys that exist in the SELECTED template whitelist when a template is selected; otherwise empty object {}.',
    '  Values must match parameter types (numbers for steps/cfg/seed/width/height, strings for text fields and ckpt_name).',
    '- "suggestedTemplateId": string or null — recommend a template id from the list when none is selected or user seems unsure.',
  ].join('\n')

  return {
    ollamaModel,
    prompt,
    selectedTemplateId,
    templateDoc,
    localCheckpoints,
    templates,
    objectInfoSummary,
  }
}

export async function completeWorkflowAssistantFromLlmRaw(
  raw: string,
  prep: PreparedWorkflowAssistantTurn,
): Promise<{
  assistant: WorkflowAssistantResult['assistant']
  resolvedWorkflow: WorkflowTemplateDoc['workflow'] | null
  patchApply: WorkflowAssistantResult['patchApply']
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
  const understandingZh = readOptionalUnderstandingZh(o.understandingZh)
  const replyZh = resolveAssistantReplyZh({
    replyRaw: o.replyZh,
    understandingZh,
    finalFallback: WORKFLOW_ASSISTANT_REPLY_FALLBACK_EN,
  })
  const confirmationOptionsZh = coerceLlmStringList(o.confirmationOptionsZh, 4)
  const intentEn = parseIntentEn(o.intentEn)

  const proposedRaw = o.proposedPatch
  let proposedPatch: Record<string, unknown> =
    proposedRaw != null && typeof proposedRaw === 'object' && !Array.isArray(proposedRaw)
      ? { ...(proposedRaw as Record<string, unknown>) }
      : {}
  if (!prep.templateDoc) {
    proposedPatch = {}
  } else {
    proposedPatch = filterPatchToWhitelist(prep.templateDoc, proposedPatch)
  }

  let suggestedTemplateId: string | null = null
  const st = o.suggestedTemplateId
  if (st === null) {
    suggestedTemplateId = null
  } else if (typeof st === 'string' && st.trim()) {
    const id = st.trim()
    if (prep.templates.some((t) => t.id === id)) {
      suggestedTemplateId = id
    } else {
      suggestedTemplateId = null
    }
  }

  let resolvedWorkflow: WorkflowTemplateDoc['workflow'] | null = null
  let patchApply: WorkflowAssistantResult['patchApply'] = null

  if (prep.templateDoc) {
    const filtered = filterPatchToWhitelist(prep.templateDoc, proposedPatch)
    const applied = applyWorkflowTemplatePatch(prep.templateDoc, filtered)
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
  }

  const assistant: WorkflowAssistantResult['assistant'] = {
    replyZh,
    understandingZh,
    confirmationOptionsZh,
    intentEn,
    proposedPatch,
    suggestedTemplateId,
  }

  return { assistant, resolvedWorkflow, patchApply }
}

export async function writeWorkflowAssistantChatStream(
  env: ServerEnv,
  body: WorkflowAssistantBody,
  writeLine: (obj: unknown) => Promise<void>,
  opts?: { signal?: AbortSignal; prep?: PreparedWorkflowAssistantTurn },
): Promise<void> {
  const prep = opts?.prep ?? (await prepareWorkflowAssistantTurn(env, body))

  const raw = await ollamaGenerateStreamCollect({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: prep.ollamaModel,
    prompt: prep.prompt,
    signal: opts?.signal,
    onToken: async (chunk) => {
      await writeLine({ type: 'delta', text: chunk })
    },
  })

  const { assistant, resolvedWorkflow, patchApply } = await completeWorkflowAssistantFromLlmRaw(raw, prep)

  await writeLine({
    type: 'final',
    ok: true,
    ollamaModel: prep.ollamaModel,
    selectedTemplateId: prep.selectedTemplateId,
    localCheckpoints: prep.localCheckpoints,
    templates: prep.templates,
    objectInfoSummary: prep.objectInfoSummary,
    assistant,
    resolvedWorkflow,
    patchApply,
  })
}

export async function runWorkflowAssistantChat(
  env: ServerEnv,
  body: WorkflowAssistantBody,
): Promise<WorkflowAssistantResult> {
  const prep = await prepareWorkflowAssistantTurn(env, body)

  const raw = await ollamaGenerateNonStream({
    ollamaBaseUrl: env.ollamaBaseUrl,
    model: prep.ollamaModel,
    prompt: prep.prompt,
  })

  const { assistant, resolvedWorkflow, patchApply } = await completeWorkflowAssistantFromLlmRaw(raw, prep)

  return {
    ollamaModel: prep.ollamaModel,
    selectedTemplateId: prep.selectedTemplateId,
    localCheckpoints: prep.localCheckpoints,
    templates: prep.templates,
    objectInfoSummary: prep.objectInfoSummary,
    assistant,
    resolvedWorkflow,
    patchApply,
  }
}
