import type { DecodedMattingImage } from './mattingImageBytes.js'
import { removeBackgroundWithImgly } from './mattingLocalImgly.js'

/** 與 `POST /images/matting/auto` body `enhancements` 對齊。 */
export type MattingEnhancements = {
  /** 第一輪後再以本機 ONNX 跑一輪（修飾邊緣／半透明邊）。 */
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

function asPngDecoded(buf: Buffer): DecodedMattingImage {
  return { buffer: buf, mime: 'image/png', filename: 'matting-round1.png' }
}

/**
 * 在第一輪 PNG 成功後執行強化階段（僅本機 ONNX 第二輪）。
 */
export async function applyMattingEnhancements(params: {
  round1Png: Buffer
  enhancements: MattingEnhancements
}): Promise<{ buffer: Buffer; appliedStepsZh: string[] }> {
  const { round1Png, enhancements } = params
  const appliedStepsZh: string[] = []
  let buf = round1Png

  if (enhancements.edgeRefine === true) {
    buf = await removeBackgroundWithImgly(asPngDecoded(buf))
    appliedStepsZh.push('邊緣強化（本機 ONNX 第二輪）')
  }

  return { buffer: buf, appliedStepsZh }
}
