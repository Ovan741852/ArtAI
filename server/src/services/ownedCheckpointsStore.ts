import fs from 'node:fs/promises'
import path from 'node:path'
import type { CivitaiModelRow } from './civitaiModelRowMap.js'
import type { CheckpointPickQuality } from './civitaiPickCheckpoint.js'

const FILE_VERSION = 1 as const

export type OwnedCheckpointEntry = {
  localFilename: string
  civitaiModelId: number
  civitaiVersionId: number
  matchQuality: CheckpointPickQuality
  civitaiSearchQuery: string
  syncedAt: string
  model: CivitaiModelRow
}

export type OwnedCheckpointsCatalog = {
  version: typeof FILE_VERSION
  updatedAt: string
  entries: OwnedCheckpointEntry[]
}

const defaultStorePath = () => path.resolve(process.cwd(), 'data', 'owned-checkpoints.json')

export function resolveOwnedCheckpointsStorePath(): string {
  const raw = process.env.OWNED_CHECKPOINTS_STORE?.trim()
  return raw && raw !== '' ? path.resolve(raw) : defaultStorePath()
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

function isOwnedCheckpointEntry(x: unknown): x is OwnedCheckpointEntry {
  if (x == null || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.localFilename === 'string' &&
    typeof o.civitaiModelId === 'number' &&
    typeof o.civitaiVersionId === 'number' &&
    typeof o.matchQuality === 'string' &&
    typeof o.civitaiSearchQuery === 'string' &&
    typeof o.syncedAt === 'string' &&
    o.model != null &&
    typeof o.model === 'object' &&
    typeof (o.model as { id?: unknown }).id === 'number'
  )
}

export async function readOwnedCheckpointsCatalog(): Promise<OwnedCheckpointsCatalog> {
  return withStoreLock(async () => {
    const filePath = resolveOwnedCheckpointsStorePath()
    let rawText: string
    try {
      rawText = await fs.readFile(filePath, 'utf8')
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined
      if (code === 'ENOENT') {
        return { version: FILE_VERSION, updatedAt: '', entries: [] }
      }
      throw e
    }

    let data: unknown
    try {
      data = JSON.parse(rawText) as unknown
    } catch {
      throw new Error(`Invalid JSON in owned checkpoints store: ${filePath}`)
    }

    if (data == null || typeof data !== 'object') {
      return { version: FILE_VERSION, updatedAt: '', entries: [] }
    }

    const o = data as Record<string, unknown>
    const entriesRaw = o.entries
    const entries: OwnedCheckpointEntry[] = []
    if (Array.isArray(entriesRaw)) {
      for (const row of entriesRaw) {
        if (isOwnedCheckpointEntry(row)) entries.push(row)
      }
    }

    return {
      version: FILE_VERSION,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      entries,
    }
  })
}

export async function writeOwnedCheckpointsCatalog(catalog: OwnedCheckpointsCatalog): Promise<void> {
  return withStoreLock(async () => {
    const filePath = resolveOwnedCheckpointsStorePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${String(process.pid)}.tmp`
    const payload = JSON.stringify(
      { version: FILE_VERSION, updatedAt: catalog.updatedAt, entries: catalog.entries },
      null,
      2,
    )
    await fs.writeFile(tmp, `${payload}\n`, 'utf8')
    await fs.rename(tmp, filePath)
  })
}
