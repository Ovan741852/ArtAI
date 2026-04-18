import type { ServerEnv } from '../config/env.js'
import { fetchCheckpointList } from './comfyuiCheckpoints.js'
import { findCivitaiForLocalCheckpoint } from './civitaiCheckpointSummary.js'
import { fetchCivitaiModelById } from './civitaiSearchModels.js'
import { mapCivitaiModelRow } from './civitaiModelRowMap.js'
import {
  readOwnedCheckpointsCatalog,
  resolveOwnedCheckpointsStorePath,
  writeOwnedCheckpointsCatalog,
  type OwnedCheckpointEntry,
} from './ownedCheckpointsStore.js'

export type SyncOwnedCheckpointsFailure = {
  localFilename: string
  message: string
  /** 若目錄裡已有該檔舊資料，同步失敗時會保留舊筆並標為 true */
  keptStale: boolean
}

export type SyncOwnedCheckpointsFromComfyResult = {
  storePath: string
  comfyuiBaseUrl: string
  comfyCheckpointCount: number
  persistedCount: number
  refreshedCount: number
  staleKeptCount: number
  failures: SyncOwnedCheckpointsFailure[]
}

export async function syncOwnedCheckpointsFromComfy(env: ServerEnv): Promise<SyncOwnedCheckpointsFromComfyResult> {
  const comfyCheckpoints = await fetchCheckpointList(env.comfyuiBaseUrl)
  const prev = await readOwnedCheckpointsCatalog()
  const prevByFile = new Map(prev.entries.map((e) => [e.localFilename, e]))

  const next: OwnedCheckpointEntry[] = []
  const failures: SyncOwnedCheckpointsFailure[] = []
  let refreshedCount = 0
  let staleKeptCount = 0

  for (const localFilename of comfyCheckpoints) {
    try {
      const resolved = await findCivitaiForLocalCheckpoint(env, { checkpoint: localFilename })
      const full = await fetchCivitaiModelById({
        civitaiBaseUrl: env.civitaiBaseUrl,
        apiKey: env.civitaiApiKey,
        modelId: resolved.item.id,
      })
      if (!full) {
        throw new Error(`Civitai GET /api/v1/models/${String(resolved.item.id)} 回傳不存在`)
      }

      next.push({
        localFilename,
        civitaiModelId: full.id,
        civitaiVersionId: resolved.version.id,
        matchQuality: resolved.matchQuality,
        civitaiSearchQuery: resolved.civitaiSearchQuery,
        syncedAt: new Date().toISOString(),
        model: mapCivitaiModelRow(full),
      })
      refreshedCount += 1
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const old = prevByFile.get(localFilename)
      if (old) {
        next.push(old)
        staleKeptCount += 1
        failures.push({ localFilename, message, keptStale: true })
      } else {
        failures.push({ localFilename, message, keptStale: false })
      }
    }
  }

  next.sort((a, b) => a.localFilename.localeCompare(b.localFilename))

  const updatedAt = new Date().toISOString()
  await writeOwnedCheckpointsCatalog({ version: 1, updatedAt, entries: next })

  return {
    storePath: resolveOwnedCheckpointsStorePath(),
    comfyuiBaseUrl: env.comfyuiBaseUrl,
    comfyCheckpointCount: comfyCheckpoints.length,
    persistedCount: next.length,
    refreshedCount,
    staleKeptCount,
    failures,
  }
}
