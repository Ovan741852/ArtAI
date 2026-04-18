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
    if (typeof raw === 'string' && !raw.trim()) {
      return { ok: false, message: `param "${key}": expected integer` }
    }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
    if (!Number.isFinite(n)) {
      return { ok: false, message: `param "${key}": expected integer` }
    }
    const intVal = Math.round(n)
    return { ok: true, value: clampNum(intVal, spec.min, spec.max) }
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) {
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
