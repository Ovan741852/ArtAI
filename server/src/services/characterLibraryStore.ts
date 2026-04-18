import fs from 'node:fs/promises'
import path from 'node:path'
import type { ServerEnv } from '../config/env.js'

const FILE_VERSION = 1 as const

export type CharacterImageRecord = {
  id: string
  /** Relative to character library files root: `{characterId}/{imageId}.{ext}` */
  relPath: string
  mime: string
  addedAt: string
}

export type CharacterProfileRecord = {
  /** Parsed JSON object (English-oriented fields from VLM). */
  profileEn: Record<string, unknown>
  summaryZh: string
  mergedAt: string
}

export type CharacterRecord = {
  id: string
  displayName: string | null
  createdAt: string
  updatedAt: string
  /** Index 0 is anchor (first approved image); never reorder. */
  images: CharacterImageRecord[]
  profile: CharacterProfileRecord | null
}

export type CharacterLibraryIndex = {
  version: typeof FILE_VERSION
  updatedAt: string
  characters: CharacterRecord[]
}

function resolveStorePathFromEnv(env: ServerEnv): string {
  return path.resolve(env.characterLibraryStorePath)
}

let storeLock: Promise<unknown> = Promise.resolve()

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeLock.then(fn)
  storeLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function isCharacterImageRecord(x: unknown): x is CharacterImageRecord {
  if (x == null || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.relPath === 'string' &&
    typeof o.mime === 'string' &&
    typeof o.addedAt === 'string'
  )
}

function isCharacterProfileRecord(x: unknown): x is CharacterProfileRecord {
  if (x == null || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    o.profileEn != null &&
    typeof o.profileEn === 'object' &&
    typeof o.summaryZh === 'string' &&
    typeof o.mergedAt === 'string'
  )
}

function isCharacterRecord(x: unknown): x is CharacterRecord {
  if (x == null || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.createdAt !== 'string' || typeof o.updatedAt !== 'string') return false
  if (o.displayName != null && typeof o.displayName !== 'string') return false
  const imgs = o.images
  if (!Array.isArray(imgs)) return false
  for (const row of imgs) {
    if (!isCharacterImageRecord(row)) return false
  }
  if (o.profile !== undefined && o.profile !== null && !isCharacterProfileRecord(o.profile)) return false
  return true
}

export async function readCharacterLibraryIndex(env: ServerEnv): Promise<CharacterLibraryIndex> {
  return withStoreLock(async () => {
    const filePath = resolveStorePathFromEnv(env)
    let rawText: string
    try {
      rawText = await fs.readFile(filePath, 'utf8')
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined
      if (code === 'ENOENT') {
        return { version: FILE_VERSION, updatedAt: '', characters: [] }
      }
      throw e
    }

    let data: unknown
    try {
      data = JSON.parse(rawText) as unknown
    } catch {
      throw new Error(`Invalid JSON in character library store: ${filePath}`)
    }

    if (data == null || typeof data !== 'object') {
      return { version: FILE_VERSION, updatedAt: '', characters: [] }
    }

    const o = data as Record<string, unknown>
    const charsRaw = o.characters
    const characters: CharacterRecord[] = []
    if (Array.isArray(charsRaw)) {
      for (const row of charsRaw) {
        if (isCharacterRecord(row)) {
          const r = row as CharacterRecord
          characters.push({
            ...r,
            displayName: r.displayName ?? null,
            profile: r.profile ?? null,
          })
        }
      }
    }

    return {
      version: FILE_VERSION,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      characters,
    }
  })
}

export async function writeCharacterLibraryIndex(env: ServerEnv, index: CharacterLibraryIndex): Promise<void> {
  return withStoreLock(async () => {
    const filePath = resolveStorePathFromEnv(env)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${String(process.pid)}.tmp`
    const payload = JSON.stringify(
      { version: FILE_VERSION, updatedAt: index.updatedAt, characters: index.characters },
      null,
      2,
    )
    await fs.writeFile(tmp, `${payload}\n`, 'utf8')
    await fs.rename(tmp, filePath)
  })
}

export function findCharacterById(index: CharacterLibraryIndex, id: string): CharacterRecord | undefined {
  return index.characters.find((c) => c.id === id)
}
