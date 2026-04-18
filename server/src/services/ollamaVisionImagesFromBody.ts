import { Buffer } from 'node:buffer'
import { AppHttpError } from './civitaiCheckpointSummary.js'

/** 單張解碼後上限（與既有助手一致）。 */
export const MAX_OLLAMA_VISION_IMAGE_BYTES = 8 * 1024 * 1024

/** 單次請求最多送進 Ollama `images` 的張數。 */
export const MAX_OLLAMA_VISION_IMAGES = 6

function normalizeOneBase64String(raw: string, fieldLabel: string): string {
  let s = raw.trim()
  if (!s) {
    throw new AppHttpError(400, `${fieldLabel} must be non-empty when provided`)
  }
  const dataUrl = /^data:image\/[^;]+;base64,(.+)$/i.exec(s)
  if (dataUrl) s = dataUrl[1].replace(/\s/g, '')
  else s = s.replace(/\s/g, '')
  try {
    const buf = Buffer.from(s, 'base64')
    if (buf.byteLength === 0) {
      throw new AppHttpError(400, `${fieldLabel} decodes to empty`)
    }
    if (buf.byteLength > MAX_OLLAMA_VISION_IMAGE_BYTES) {
      throw new AppHttpError(400, `${fieldLabel} too large (max 8 MB after decode)`)
    }
  } catch (e) {
    if (e instanceof AppHttpError) throw e
    throw new AppHttpError(400, `${fieldLabel} is not valid base64`)
  }
  return s
}

/**
 * 從 JSON body 解析 Ollama `/api/generate` 用的 `images` 陣列（無 data URL 前綴）。
 * - `imageBase64`：可選單張（先於陣列合併）。
 * - `imageBase64s`：可選字串陣列；空元素略過；型別錯誤則 400。
 * 合併順序：`[imageBase64, ...imageBase64s]`；總張數超過 {@link MAX_OLLAMA_VISION_IMAGES} 則 400。
 */
export function parseOllamaVisionImagesFromBody(body: Record<string, unknown>): { imagesBase64: string[] } {
  const out: string[] = []

  if (Object.prototype.hasOwnProperty.call(body, 'imageBase64')) {
    const single = body.imageBase64
    if (single == null) {
      /* omit */
    } else if (typeof single !== 'string') {
      throw new AppHttpError(400, 'imageBase64 must be a string when provided')
    } else if (single.trim()) {
      out.push(normalizeOneBase64String(single, 'imageBase64'))
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'imageBase64s')) {
    const arrRaw = body.imageBase64s
    if (arrRaw == null) {
      /* omit */
    } else if (!Array.isArray(arrRaw)) {
      throw new AppHttpError(400, 'imageBase64s must be an array when provided')
    } else {
      for (let i = 0; i < arrRaw.length; i++) {
        const el = arrRaw[i]
        if (el == null) continue
        if (typeof el !== 'string') {
          throw new AppHttpError(400, `imageBase64s[${String(i)}] must be a string`)
        }
        if (!el.trim()) continue
        out.push(normalizeOneBase64String(el, `imageBase64s[${String(i)}]`))
      }
    }
  }

  if (out.length > MAX_OLLAMA_VISION_IMAGES) {
    throw new AppHttpError(
      400,
      `At most ${String(MAX_OLLAMA_VISION_IMAGES)} reference images allowed (after merging imageBase64 and imageBase64s)`,
    )
  }

  return { imagesBase64: out }
}

/**
 * 兩張圖明確欄位（錨點 vs候選），供身分延續 gate；規則與單張相同（8MB、base64 正規化）。
 */
export function parseAnchorAndCandidateImages(body: Record<string, unknown>): {
  anchorImageBase64: string
  candidateImageBase64: string
} {
  const anchorRaw = body.anchorImageBase64
  const candRaw = body.candidateImageBase64
  if (anchorRaw == null || typeof anchorRaw !== 'string' || !anchorRaw.trim()) {
    throw new AppHttpError(400, 'anchorImageBase64 is required (non-empty string)')
  }
  if (candRaw == null || typeof candRaw !== 'string' || !candRaw.trim()) {
    throw new AppHttpError(400, 'candidateImageBase64 is required (non-empty string)')
  }
  return {
    anchorImageBase64: normalizeOneBase64String(anchorRaw, 'anchorImageBase64'),
    candidateImageBase64: normalizeOneBase64String(candRaw, 'candidateImageBase64'),
  }
}
