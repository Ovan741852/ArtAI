import type { MattingClassification } from './mattingClassify.js'

type InputFieldSpec = unknown

function asRecord(x: unknown): Record<string, InputFieldSpec> {
  if (x == null || typeof x !== 'object') return {}
  return x as Record<string, InputFieldSpec>
}

function pickDropdownOption(options: string[], classification: MattingClassification): string {
  const humanish = /human|portrait|isnet|silueta|u2net_human|segment|general|isnet-general/i
  const isHumanLike =
    classification.primarySubject === 'single_human_portrait' ||
    classification.primarySubject === 'multiple_humans'

  if (isHumanLike) {
    const hit = options.find((o) => humanish.test(o))
    if (hit) return hit
  }
  return options[0] ?? 'u2net'
}

/**
 * 依 Comfy `object_info` 的 `input.required` 產生靜態欄位預設值（不含 IMAGE 連線）。
 */
export function buildStaticInputsFromRequired(
  required: Record<string, InputFieldSpec>,
  classification: MattingClassification,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}

  for (const [key, spec] of Object.entries(required)) {
    if (!Array.isArray(spec) || spec.length < 1) continue
    const head = spec[0]

    if (head === 'IMAGE') continue

    if (head === 'BOOLEAN') {
      const extra = spec.length > 1 ? asRecord(spec[1]) : {}
      if (typeof extra.default === 'boolean') inputs[key] = extra.default
      else inputs[key] = false
      continue
    }

    if (head === 'INT') {
      const extra = spec.length > 1 ? asRecord(spec[1]) : {}
      if (typeof extra.default === 'number') inputs[key] = Math.floor(extra.default)
      else inputs[key] = typeof extra.min === 'number' ? Math.floor(extra.min) : 0
      continue
    }

    if (head === 'FLOAT') {
      const extra = spec.length > 1 ? asRecord(spec[1]) : {}
      if (typeof extra.default === 'number') inputs[key] = extra.default
      else inputs[key] = typeof extra.min === 'number' ? extra.min : 0
      continue
    }

    if (head === 'STRING') {
      const extra = spec.length > 1 ? asRecord(spec[1]) : {}
      if (typeof extra.default === 'string') inputs[key] = extra.default
      else inputs[key] = ''
      continue
    }

    if (Array.isArray(head)) {
      const options = head.filter((x): x is string => typeof x === 'string')
      if (options.length > 0) {
        inputs[key] = pickDropdownOption(options, classification)
      }
      continue
    }
  }

  return inputs
}
