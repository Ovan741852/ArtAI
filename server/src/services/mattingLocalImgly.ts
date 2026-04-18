import { removeBackground } from '@imgly/background-removal'
import type { DecodedMattingImage } from './mattingImageBytes.js'

/**
 * Node 下勿用 `Blob` 餵給 onnxruntime（內部會變成 `blob:` URL，ESM loader 不支援）。
 * 使用 `Uint8Array` 搭配原始圖檔 MIME 對應之編碼位元組。
 */
export async function removeBackgroundWithImgly(image: DecodedMattingImage): Promise<Buffer> {
  const u8 = Uint8Array.from(image.buffer)
  const out = await removeBackground(u8, {
    output: { format: 'image/png' },
  })
  return Buffer.from(await out.arrayBuffer())
}
