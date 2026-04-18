import type { DecodedMattingImage } from './mattingImageBytes.js'
import { refineMattingWithOriginal } from './mattingEdgeRefineWithOriginal.js'

/** 與 `POST /images/matting/auto` body `enhancements` 對齊。 */
export type MattingEnhancements = {
  /**
   * 第一輪成功後：以**原圖**與第一輪 PNG 在 alpha 邊界帶內混合 RGB（保留 alpha），修飾邊緣糊／輕微溢色。
   * 不再呼叫第二輪 WASM 去背。
   */
  edgeRefine?: boolean
}

export function parseMattingEnhancements(raw: unknown): MattingEnhancements {
  if (raw == null || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  return {
    edgeRefine: o.edgeRefine === true,
  }
}

export function anyMattingEnhancement(e: MattingEnhancements | undefined): boolean {
  if (e == null || typeof e !== 'object') return false
  return e.edgeRefine === true
}

/**
 * 在第一輪 PNG 成功後執行強化（原圖對齊邊界帶）。
 */
export async function applyMattingEnhancements(params: {
  original: DecodedMattingImage
  round1Png: Buffer
  enhancements: MattingEnhancements
}): Promise<{ buffer: Buffer; appliedStepsZh: string[] }> {
  const { original, round1Png, enhancements } = params
  const appliedStepsZh: string[] = []
  let buf = round1Png

  if (enhancements.edgeRefine === true) {
    buf = await refineMattingWithOriginal(original, round1Png)
    appliedStepsZh.push('邊緣強化（原圖對齊邊界帶）')
  }

  return { buffer: buf, appliedStepsZh }
}
