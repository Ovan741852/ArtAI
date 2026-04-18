import fs from 'node:fs/promises'
import path from 'node:path'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'bin'
}

function filesRoot(env: ServerEnv): string {
  return path.resolve(env.characterLibraryFilesDir)
}

export function characterImageDiskPath(env: ServerEnv, relPath: string): string {
  const root = filesRoot(env)
  const resolved = path.resolve(root, relPath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new AppHttpError(400, 'Invalid image path')
  }
  return resolved
}

export async function writeCharacterImageFile(params: {
  env: ServerEnv
  characterId: string
  imageId: string
  buffer: Buffer
  mime: string
}): Promise<{ relPath: string }> {
  const { env, characterId, imageId, buffer, mime } = params
  if (!/^[a-f0-9-]{36}$/i.test(imageId)) {
    throw new AppHttpError(500, 'Invalid image id')
  }
  const ext = extForMime(mime)
  if (ext === 'bin') {
    throw new AppHttpError(400, 'Unsupported image mime for storage')
  }
  const safeCharId = characterId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (safeCharId !== characterId || !characterId) {
    throw new AppHttpError(500, 'Invalid character id')
  }

  const relPath = path.join(characterId, `${imageId}.${ext}`).replace(/\\/g, '/')
  const abs = characterImageDiskPath(env, relPath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, buffer)
  return { relPath }
}

export async function readCharacterImageFile(env: ServerEnv, relPath: string): Promise<{ buffer: Buffer; mime: string }> {
  const abs = characterImageDiskPath(env, relPath)
  try {
    const buffer = await fs.readFile(abs)
    const lower = relPath.toLowerCase()
    let mime = 'application/octet-stream'
    if (lower.endsWith('.png')) mime = 'image/png'
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg'
    else if (lower.endsWith('.webp')) mime = 'image/webp'
    return { buffer, mime }
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') {
      throw new AppHttpError(404, 'Image file not found')
    }
    throw e
  }
}
