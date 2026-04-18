export type MattingComfyTier = 'fine' | 'general'

export type MattingComfyCandidate = {
  classType: string
  tier: MattingComfyTier
}

const FINE_RE =
  /birefnet|rmbg|isnet|modnet|human.?matte|portrait.?matte|silueta|u2net_human|inspyrenet|dis.?bg|disbg/i

const GENERAL_RE =
  /rembg|remove.?back|background.?rem|去背|matting|segment.?foreground|u2net(?!_human)|sam.?mask|grounding/i

function tierForClassType(classType: string): MattingComfyTier | null {
  if (FINE_RE.test(classType)) return 'fine'
  if (GENERAL_RE.test(classType)) return 'general'
  return null
}

/**
 * 從 Comfy `object_info` 頂層鍵掃描可能支援「單張 IMAGE → 去背／分割」的節點。
 * 僅供路由決策；實際能否串 LoadImage 仍由 {@link canWireSimpleImageMatting} 驗證。
 */
export function listMattingComfyCandidates(objectInfo: unknown): MattingComfyCandidate[] {
  if (objectInfo == null || typeof objectInfo !== 'object') return []
  const keys = Object.keys(objectInfo as Record<string, unknown>)
  const out: MattingComfyCandidate[] = []
  for (const classType of keys) {
    const tier = tierForClassType(classType)
    if (!tier) continue
    out.push({ classType, tier })
  }
  out.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'fine' ? -1 : 1
    return a.classType.localeCompare(b.classType)
  })
  return out
}

type InputFieldSpec = unknown

function getRequiredMap(nodeDef: unknown): Record<string, InputFieldSpec> {
  if (nodeDef == null || typeof nodeDef !== 'object') return {}
  const input = (nodeDef as Record<string, unknown>).input
  if (input == null || typeof input !== 'object') return {}
  const req = (input as Record<string, unknown>).required
  if (req == null || typeof req !== 'object') return {}
  return req as Record<string, InputFieldSpec>
}

function countImageInputs(required: Record<string, InputFieldSpec>): number {
  let n = 0
  for (const spec of Object.values(required)) {
    if (Array.isArray(spec) && spec[0] === 'IMAGE') n += 1
  }
  return n
}

function hasBlockedRequired(required: Record<string, InputFieldSpec>): boolean {
  for (const spec of Object.values(required)) {
    if (!Array.isArray(spec) || spec.length < 1) continue
    const t = spec[0]
    if (t === 'LATENT' || t === 'MASK' || t === 'MODEL') return true
  }
  return false
}

export function canWireSimpleImageMatting(nodeDef: unknown): boolean {
  const required = getRequiredMap(nodeDef)
  if (hasBlockedRequired(required)) return false
  return countImageInputs(required) === 1
}

export function firstImageOutputSlot(nodeDef: unknown): number {
  if (nodeDef == null || typeof nodeDef !== 'object') return 0
  const out = (nodeDef as Record<string, unknown>).output
  if (!Array.isArray(out)) return 0
  const ix = (out as unknown[]).findIndex((x) => x === 'IMAGE')
  return ix >= 0 ? ix : 0
}
