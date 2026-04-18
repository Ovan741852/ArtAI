import sharp from 'sharp'
import type { DecodedMattingImage } from './mattingImageBytes.js'

/** 半透明邊界帶：alpha 在此區間內視為「邊緣」並向原圖取色混合。 */
const ALPHA_EDGE_LO = 14
const ALPHA_EDGE_HI = 241
/** 原圖在邊界帶的混合權重（越大越貼原圖細節）。 */
const ORIGINAL_MIX = 0.42

function clampByte(n: number): number {
  if (n < 0) return 0
  if (n > 255) return 255
  return Math.round(n)
}

/**
 * 將圖置於透明 WxH 畫布中央（`fit: 'contain'`），與另一張對齊用。
 */
async function rgbaCenteredOnCanvas(buf: Buffer, width: number, height: number): Promise<Buffer> {
  const inner = await sharp(buf, { failOn: 'none' })
    .rotate()
    .ensureAlpha()
    .resize(width, height, { fit: 'contain' })
    .png()
    .toBuffer()

  const { data, info } = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: inner, gravity: 'centre' }])
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.channels !== 4) {
    throw new Error(`Expected RGBA raw output, got ${String(info.channels)} channels`)
  }
  return Buffer.from(data)
}

/**
 * 第一輪去背結果與**原圖**對齊尺寸後，在 alpha 邊界帶內把 RGB 向原圖混合，保留第一輪 alpha（略修飾邊緣糊／溢色）。
 * 不依賴 WASM 第二輪去背。
 */
export async function refineMattingWithOriginal(
  original: DecodedMattingImage,
  cutoutPng: Buffer,
): Promise<Buffer> {
  const meta = await sharp(original.buffer, { failOn: 'none' }).rotate().metadata()
  const w = meta.width
  const h = meta.height
  if (w == null || h == null || w < 2 || h < 2) {
    throw new Error('Cannot read original image dimensions')
  }

  const origFlat = await rgbaCenteredOnCanvas(original.buffer, w, h)
  const cutFlat = await rgbaCenteredOnCanvas(cutoutPng, w, h)

  const n = w * h
  const out = Buffer.allocUnsafe(n * 4)
  const mix = ORIGINAL_MIX

  for (let i = 0; i < n; i++) {
    const p = i * 4
    const oR = origFlat[p]
    const oG = origFlat[p + 1]
    const oB = origFlat[p + 2]
    const cR = cutFlat[p]
    const cG = cutFlat[p + 1]
    const cB = cutFlat[p + 2]
    const cA = cutFlat[p + 3]

    const edge = cA > ALPHA_EDGE_LO && cA < ALPHA_EDGE_HI
    if (edge) {
      out[p] = clampByte(cR * (1 - mix) + oR * mix)
      out[p + 1] = clampByte(cG * (1 - mix) + oG * mix)
      out[p + 2] = clampByte(cB * (1 - mix) + oB * mix)
      out[p + 3] = cA
    } else {
      out[p] = cR
      out[p + 1] = cG
      out[p + 2] = cB
      out[p + 3] = cA
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}
