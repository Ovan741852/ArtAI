import type { WhitelistParamSpec, WorkflowTemplateDoc } from './workflowTemplatesRegistry.js'

function cloneWorkflow(
  wf: WorkflowTemplateDoc['workflow'],
): WorkflowTemplateDoc['workflow'] {
  const out: WorkflowTemplateDoc['workflow'] = {}
  for (const [nid, node] of Object.entries(wf)) {
    out[nid] = {
      class_type: node.class_type,
      inputs: { ...node.inputs },
    }
  }
  return out
}

function clampNum(n: number, min?: number, max?: number): number {
  let x = n
  if (min != null && x < min) x = min
  if (max != null && x > max) x = max
  return x
}

/**
 * 將 LLM／前端可能給的亂格式轉成有限數字；無法解析則 null。
 * 含：bigint、小數字串、字串內嵌數字、random 語意。
 */
function parseNumericLoose(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw) && raw.length === 1) {
    return parseNumericLoose(raw[0])
  }
  if (typeof raw === 'bigint') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (typeof raw === 'boolean') {
    return raw ? 1 : 0
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'string') {
    const s0 = raw.trim()
    if (!s0) return null
    const s = s0.toLowerCase()
    if (s === 'random' || s === 'rand' || s === 'shuffle' || s === 'any') {
      return Math.floor(Math.random() * 2_147_483_648)
    }
    let n = Number(s0.replace(/,/g, ''))
    if (Number.isFinite(n)) {
      return n
    }
    const m = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(s0.replace(/\s/g, ''))
    if (m) {
      n = Number(m[0])
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  return null
}

function coerceToNonEmptyString(key: string, raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (raw == null) {
    return { ok: false, message: `param "${key}": expected a non-empty string (got null/undefined)` }
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) {
      return { ok: false, message: `param "${key}": string must not be empty` }
    }
    return { ok: true, value: s }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const s = String(raw).trim()
    if (!s) {
      return { ok: false, message: `param "${key}": string must not be empty` }
    }
    return { ok: true, value: s }
  }
  const kind = Array.isArray(raw) ? 'array' : typeof raw
  return { ok: false, message: `param "${key}": expected string (got ${kind})` }
}

function coerceValue(
  key: string,
  spec: WhitelistParamSpec,
  raw: unknown,
): { ok: true; value: string | number } | { ok: false; message: string } {
  if (spec.type === 'string') {
    return coerceToNonEmptyString(key, raw)
  }
  if (spec.type === 'int') {
    const n = parseNumericLoose(raw)
    if (n == null || !Number.isFinite(n)) {
      return { ok: false, message: `param "${key}": expected integer (got ${typeof raw})` }
    }
    const intVal = Math.round(n)
    return { ok: true, value: clampNum(intVal, spec.min, spec.max) }
  }
  const n = parseNumericLoose(raw)
  if (n == null || !Number.isFinite(n)) {
    return { ok: false, message: `param "${key}": expected number` }
  }
  return { ok: true, value: clampNum(n, spec.min, spec.max) }
}

export type ApplyWorkflowTemplatePatchResult =
  | {
      ok: true
      workflow: WorkflowTemplateDoc['workflow']
      appliedKeys: string[]
      ignoredKeys: string[]
    }
  | {
      ok: false
      message: string
    }

/**
 * 依模板白名單將 `patch` 套入 workflow 的深拷貝；非白名單鍵會列入 `ignoredKeys`。
 */
export function applyWorkflowTemplatePatch(
  template: WorkflowTemplateDoc,
  patch: Record<string, unknown>,
): ApplyWorkflowTemplatePatchResult {
  const workflow = cloneWorkflow(template.workflow)
  const appliedKeys: string[] = []
  const ignoredKeys: string[] = []

  for (const [key, raw] of Object.entries(patch)) {
    const spec = template.whitelistParams[key]
    if (!spec) {
      ignoredKeys.push(key)
      continue
    }
    if (raw === null || raw === undefined) {
      ignoredKeys.push(key)
      continue
    }
    if (typeof raw === 'string' && !raw.trim() && spec.type !== 'string') {
      ignoredKeys.push(key)
      continue
    }
    const node = workflow[spec.nodeId]
    if (!node) {
      return {
        ok: false,
        message: `Template workflow missing node "${spec.nodeId}" for param "${key}"`,
      }
    }
    const coerced = coerceValue(key, spec, raw)
    if (!coerced.ok) {
      return { ok: false, message: coerced.message }
    }
    node.inputs[spec.inputKey] = coerced.value
    appliedKeys.push(key)
  }

  return { ok: true, workflow, appliedKeys, ignoredKeys }
}
