export type MattingComfyTier = 'fine' | 'general'

export type MattingComfyCandidate = {
  classType: string
  tier: MattingComfyTier
}

/**
 * 已知無法由 ArtAI 單線自動串接之節點（仍可能出現在 object_info）。
 * - `ImageRemoveBackground+`：需 `rembg_session` 等自訂型別連線。
 * - `RecraftRemoveBackgroundNode`：名稱命中「remove background」關鍵字，多為雲端／授權流程，簡易 prompt 常執行失敗。
 */
const MATTING_CLASS_BLOCKLIST = new Set<string>(['ImageRemoveBackground+', 'RecraftRemoveBackgroundNode'])

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
    if (MATTING_CLASS_BLOCKLIST.has(classType)) continue
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

/**
 * 僅當 `input.required` 內 **恰好一個 IMAGE**（由我們接 LoadImage），其餘必填欄位皆為我們能自動填的值型別時，
 * 才允許自動串 `LoadImage → 節點 → SaveImage`。
 *
 * 否則會出現 Comfy 驗證錯誤（例如 `ImageRemoveBackground+` 需要 `rembg_session` 等自訂型別連線）。
 */
function isSimpleAutomatableMattingNode(required: Record<string, InputFieldSpec>): boolean {
  let imageInputs = 0
  for (const spec of Object.values(required)) {
    if (!Array.isArray(spec) || spec.length < 1) return false
    const head = spec[0]

    if (head === 'IMAGE') {
      imageInputs += 1
      continue
    }

    if (head === 'LATENT' || head === 'MASK' || head === 'MODEL') return false

    if (head === 'BOOLEAN' || head === 'INT' || head === 'FLOAT' || head === 'STRING') continue

    if (Array.isArray(head)) {
      const options = head.filter((x): x is string => typeof x === 'string')
      if (options.length > 0) continue
      return false
    }

    // 未知型別字串（如 REMBG_SESSION、CUSTOM、CLIP_VISION 等）無法自動接線
    return false
  }

  return imageInputs === 1
}

export function canWireSimpleImageMatting(nodeDef: unknown): boolean {
  const required = getRequiredMap(nodeDef)
  return isSimpleAutomatableMattingNode(required)
}

export function firstImageOutputSlot(nodeDef: unknown): number {
  if (nodeDef == null || typeof nodeDef !== 'object') return 0
  const out = (nodeDef as Record<string, unknown>).output
  if (!Array.isArray(out)) return 0
  const ix = (out as unknown[]).findIndex((x) => x === 'IMAGE')
  return ix >= 0 ? ix : 0
}
