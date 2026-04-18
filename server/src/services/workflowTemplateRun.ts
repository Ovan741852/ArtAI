import type { ServerEnv } from '../config/env.js'
import { applyWorkflowTemplatePatch } from './applyWorkflowTemplatePatch.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { runComfyPromptToFirstPngBuffer } from './comfyPromptExecution.js'
import { getWorkflowTemplateById } from './workflowTemplatesRegistry.js'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const DEFAULT_RUN_TIMEOUT_MS = 600_000

function parseTemplateIdParam(id: string): string {
  const t = id.trim()
  if (!ID_RE.test(t)) {
    throw new AppHttpError(400, 'Invalid template id in path')
  }
  return t
}

function parsePatch(raw: unknown): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppHttpError(400, 'Body field "patch" must be an object when provided')
  }
  return { ...(raw as Record<string, unknown>) }
}

function parseTimeoutMs(raw: unknown): number | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new AppHttpError(400, 'timeoutMs must be a finite number when provided')
  }
  const n = Math.floor(raw)
  if (n < 10_000 || n > 1_800_000) {
    throw new AppHttpError(400, 'timeoutMs must be between 10000 and 1800000')
  }
  return n
}

export type WorkflowTemplateRunBody = {
  patch?: Record<string, unknown>
  timeoutMs?: number
}

/**
 * 讀模板、套用白名單 patch（可空）、送 Comfy 並取回第一張輸出 PNG。
 */
export async function runWorkflowTemplateOnComfy(
  env: ServerEnv,
  templateId: string,
  body: unknown,
): Promise<{ imagePngBase64: string; patchApply: { ok: true; appliedKeys: string[]; ignoredKeys: string[] } }> {
  const id = parseTemplateIdParam(templateId)
  const rec = body != null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const patch = parsePatch(rec.patch)
  const timeoutMs = parseTimeoutMs(rec.timeoutMs) ?? DEFAULT_RUN_TIMEOUT_MS

  const template = await getWorkflowTemplateById(id)
  if (!template) {
    throw new AppHttpError(404, `Unknown workflow template: "${id}"`)
  }

  const applied = applyWorkflowTemplatePatch(template, patch)
  if (!applied.ok) {
    throw new AppHttpError(400, applied.message)
  }

  const wf = applied.workflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>
  const buf = await runComfyPromptToFirstPngBuffer({
    comfyuiBaseUrl: env.comfyuiBaseUrl,
    prompt: wf as Record<string, unknown>,
    timeoutMs,
  })

  return {
    imagePngBase64: buf.toString('base64'),
    patchApply: { ok: true, appliedKeys: applied.appliedKeys, ignoredKeys: applied.ignoredKeys },
  }
}
