import { removeBackground } from '@imgly/background-removal'
import type { DecodedMattingImage } from './mattingImageBytes.js'

export async function removeBackgroundWithImgly(image: DecodedMattingImage): Promise<Buffer> {
  const blob = new Blob([new Uint8Array(image.buffer)], { type: image.mime })
  const out = await removeBackground(blob)
  return Buffer.from(await out.arrayBuffer())
}
