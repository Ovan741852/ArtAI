import { AppHttpError } from './civitaiCheckpointSummary.js'

export const MAX_MATTING_IMAGE_BYTES = 8 * 1024 * 1024

export type DecodedMattingImage = {
  buffer: Buffer
  /** e.g. image/png, image/jpeg */
  mime: string
  /** basename for Comfy upload */
  filename: string
}

function sniffMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'application/octet-stream'
}

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'bin'
}

/**
 * 解析 `imageBase64`（可含 data URL 前綴）；驗證大小與可辨識之圖片魔數。
 */
export function decodeMattingImageBase64(raw: unknown): DecodedMattingImage {
  if (raw == null || typeof raw !== 'string') {
    throw new AppHttpError(400, 'Body field "imageBase64" is required (string)')
  }
  let s = raw.trim()
  if (!s) {
    throw new AppHttpError(400, 'Body field "imageBase64" must be non-empty')
  }
  const dataUrl = /^data:image\/[^;]+;base64,(.+)$/i.exec(s)
  if (dataUrl) s = dataUrl[1].replace(/\s/g, '')
  else s = s.replace(/\s/g, '')

  let buf: Buffer
  try {
    buf = Buffer.from(s, 'base64')
  } catch {
    throw new AppHttpError(400, 'imageBase64 is not valid base64')
  }
  if (buf.byteLength === 0) {
    throw new AppHttpError(400, 'imageBase64 decodes to empty')
  }
  if (buf.byteLength > MAX_MATTING_IMAGE_BYTES) {
    throw new AppHttpError(400, `imageBase64 too large (max ${String(MAX_MATTING_IMAGE_BYTES)} bytes after decode)`)
  }

  const mime = sniffMime(buf)
  if (mime === 'application/octet-stream') {
    throw new AppHttpError(400, 'Unrecognized image format (use PNG, JPEG, or WebP)')
  }

  const filename = `artai_mat.${extForMime(mime)}`
  return { buffer: buf, mime, filename }
}
