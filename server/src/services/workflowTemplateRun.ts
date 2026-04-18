import type { ServerEnv } from '../config/env.js'
import { applyWorkflowTemplatePatch } from './applyWorkflowTemplatePatch.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { runComfyPromptToFirstPngBuffer } from './comfyPromptExecution.js'
import { getLocalModelsDump } from './localModelsDump.js'
import {
  setFirstLoadImageFilename,
  uploadImageToComfyui,
  workflowHasLoadImage,
} from './comfyUploadImage.js'
import { decodeMattingImageBase64 } from './mattingImageBytes.js'
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
  /** 圖生圖等：解碼後上傳至 Comfy 並寫入第一個 LoadImage。可含 data URL 前綴；規則同摳圖 API。 */
  referenceImagePngBase64?: string
}

function parseReferenceImagePngBase64(rec: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(rec, 'referenceImagePngBase64')) {
    return null
  }
  const v = rec.referenceImagePngBase64
  if (v == null || typeof v !== 'string' || !v.trim()) {
    return null
  }
  return v.trim()
}

/**
 * 若模板白名單含 `ckpt_name` 且 ArtAI 能從 Comfy 取得非空 checkpoint 清單，則先比對，避免 Comfy 回難讀的 validation 錯誤。
 */
async function assertResolvedCkptNameOnComfy(
  env: ServerEnv,
  template: { whitelistParams: Record<string, { nodeId: string; inputKey: string }> },
  wf: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): Promise<void> {
  const spec = template.whitelistParams.ckpt_name
  if (!spec || typeof spec.nodeId !== 'string' || typeof spec.inputKey !== 'string') {
    return
  }
  const node = wf[spec.nodeId]
  if (!node?.inputs) return
  const raw = node.inputs[spec.inputKey]
  if (typeof raw !== 'string' || !raw.trim()) return
  const ckpt = raw.trim()

  const dump = await getLocalModelsDump(env, { force: false })
  const src = dump.sources.comfyui
  if (!src.ok || src.checkpoints.length === 0) {
    return
  }
  if (new Set(src.checkpoints).has(ckpt)) {
    return
  }
  const sorted = [...src.checkpoints].sort((a, b) => a.localeCompare(b))
  const sample = sorted.slice(0, 8).join(', ')
  const more = src.checkpoints.length > 8 ? ' …' : ''
  throw new AppHttpError(
    400,
    `本機 ComfyUI 沒有名為「${ckpt}」的 checkpoint（與 models/checkpoints 內檔名需完全一致）。` +
      `請在 patch 指定正確的 ckpt_name。目前可偵測的範例：${sample}${more}（共 ${String(src.checkpoints.length)} 個）。`,
  )
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
  const refB64 = parseReferenceImagePngBase64(rec)

  const template = await getWorkflowTemplateById(id)
  if (!template) {
    throw new AppHttpError(404, `Unknown workflow template: "${id}"`)
  }

  const applied = applyWorkflowTemplatePatch(template, patch)
  if (!applied.ok) {
    throw new AppHttpError(400, applied.message)
  }

  const wf = applied.workflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>

  if (refB64) {
    if (!workflowHasLoadImage(wf)) {
      throw new AppHttpError(400, '此模板不含 LoadImage，無法使用 referenceImagePngBase64')
    }
    try {
      const decoded = decodeMattingImageBase64(refB64)
      const uploadedName = await uploadImageToComfyui(env.comfyuiBaseUrl, decoded)
      setFirstLoadImageFilename(wf, uploadedName)
    } catch (e) {
      if (e instanceof AppHttpError) throw e
      const msg = e instanceof Error ? e.message : String(e)
      throw new AppHttpError(400, `參考圖處理失敗：${msg}`)
    }
  }

  await assertResolvedCkptNameOnComfy(env, template, wf)

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
