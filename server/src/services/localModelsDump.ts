import type { ServerEnv } from '../config/env.js'
import type { CivitaiModelRow } from './civitaiModelRowMap.js'
import { fetchCheckpointList } from './comfyuiCheckpoints.js'
import { fetchOllamaTags, type OllamaTagModel } from './ollamaTags.js'
import { readOwnedCheckpointsCatalog, resolveOwnedCheckpointsStorePath } from './ownedCheckpointsStore.js'

function truncateText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function pickVersionPreview(model: CivitaiModelRow, versionId: number) {
  const hit = model.modelVersionsPreview.find((v) => v.id === versionId)
  return hit ?? model.modelVersionsPreview[0]
}

export type LocalModelsDumpCore = {
  sources: {
    comfyui: {
      baseUrl: string
      ok: boolean
      checkpointCount: number
      checkpoints: string[]
      error?: string
    }
    ollama: {
      baseUrl: string
      ok: boolean
      modelCount: number
      models: OllamaTagModel[]
      modelNames: string[]
      error?: string
    }
    checkpointCatalog: {
      storePath: string
      /** 目錄 JSON 內的 `updatedAt`（同步流程寫入）。無檔或空則為 null。 */
      catalogUpdatedAt: string | null
      entryCount: number
      entries: Array<{
        localFilename: string
        civitaiModelId: number
        civitaiVersionId: number
        matchQuality: string
        civitaiSearchQuery: string
        syncedAt: string
        civitaiModelName: string | null
        /** Civitai 模型 tags（目錄 JSON 內已存之 `model.tags`）。 */
        civitaiTags: string[]
        /** 去 HTML 後的 Civitai 模型描述（多為英文），截斷上限較大供工具／AI 閱讀。 */
        civitaiDescriptionPreview: string
        civitaiTrainedWords: string[]
        civitaiBaseModel: string | null
        civitaiCreatorUsername: string | null
      }>
    }
  }
  summary: {
    comfyCheckpointCount: number
    ollamaModelCount: number
    catalogEntryCount: number
  }
}

type CacheShape = {
  refreshedAt: string
  cachedAtMs: number
  core: LocalModelsDumpCore
}

let dumpCache: CacheShape | null = null

async function buildFreshCore(env: ServerEnv): Promise<LocalModelsDumpCore> {
  const comfyP = fetchCheckpointList(env.comfyuiBaseUrl).then(
    (checkpoints) =>
      ({
        baseUrl: env.comfyuiBaseUrl,
        ok: true as const,
        checkpointCount: checkpoints.length,
        checkpoints,
      }) satisfies LocalModelsDumpCore['sources']['comfyui'],
    (e) =>
      ({
        baseUrl: env.comfyuiBaseUrl,
        ok: false as const,
        checkpointCount: 0,
        checkpoints: [] as string[],
        error: e instanceof Error ? e.message : String(e),
      }) satisfies LocalModelsDumpCore['sources']['comfyui'],
  )

  const ollamaP = fetchOllamaTags(env.ollamaBaseUrl).then(
    ({ models }) => {
      const modelNames = models.map((m) => m.name)
      return {
        baseUrl: env.ollamaBaseUrl,
        ok: true as const,
        modelCount: models.length,
        models,
        modelNames,
      } satisfies LocalModelsDumpCore['sources']['ollama']
    },
    (e) =>
      ({
        baseUrl: env.ollamaBaseUrl,
        ok: false as const,
        modelCount: 0,
        models: [] as OllamaTagModel[],
        modelNames: [] as string[],
        error: e instanceof Error ? e.message : String(e),
      }) satisfies LocalModelsDumpCore['sources']['ollama'],
  )

  const catalog = await readOwnedCheckpointsCatalog()
  const storePath = resolveOwnedCheckpointsStorePath()
  const catalogUpdatedAt = catalog.updatedAt && catalog.updatedAt !== '' ? catalog.updatedAt : null

  const [comfyui, ollama] = await Promise.all([comfyP, ollamaP])

  const entries = catalog.entries.map((e) => {
    const ver = pickVersionPreview(e.model, e.civitaiVersionId)
    return {
      localFilename: e.localFilename,
      civitaiModelId: e.civitaiModelId,
      civitaiVersionId: e.civitaiVersionId,
      matchQuality: e.matchQuality,
      civitaiSearchQuery: e.civitaiSearchQuery,
      syncedAt: e.syncedAt,
      civitaiModelName: e.model?.name ?? null,
      civitaiTags: [...(e.model.tags ?? [])],
      civitaiDescriptionPreview: truncateText(e.model.descriptionText ?? '', 12_000),
      civitaiTrainedWords: [...(ver?.trainedWords ?? [])],
      civitaiBaseModel: ver?.baseModel ?? null,
      civitaiCreatorUsername: e.model.creatorUsername ?? null,
    }
  })

  const core: LocalModelsDumpCore = {
    sources: {
      comfyui,
      ollama,
      checkpointCatalog: {
        storePath,
        catalogUpdatedAt,
        entryCount: catalog.entries.length,
        entries,
      },
    },
    summary: {
      comfyCheckpointCount: comfyui.checkpointCount,
      ollamaModelCount: ollama.modelCount,
      catalogEntryCount: catalog.entries.length,
    },
  }

  return core
}

export type LocalModelsDumpHttpPayload = LocalModelsDumpCore & {
  ok: true
  /** 本次快照產生時間（ISO 8601）。若 `fromCache` 為 true，代表快取建立當下的時間。 */
  refreshedAt: string
  fromCache: boolean
  cacheTtlMs: number
  /** 快取仍有效時，建議最早可再視為「過期」的時間（ISO）；`cacheTtlMs=0` 時為 null。 */
  staleAt: string | null
}

export async function getLocalModelsDump(env: ServerEnv, opts: { force: boolean }): Promise<LocalModelsDumpHttpPayload> {
  const ttl = env.localModelsDumpTtlMs
  const now = Date.now()

  if (!opts.force && ttl > 0 && dumpCache && now - dumpCache.cachedAtMs < ttl) {
    const staleAt =
      ttl > 0 ? new Date(dumpCache.cachedAtMs + ttl).toISOString() : null
    return {
      ok: true,
      refreshedAt: dumpCache.refreshedAt,
      fromCache: true,
      cacheTtlMs: ttl,
      staleAt,
      ...dumpCache.core,
    }
  }

  const core = await buildFreshCore(env)
  const refreshedAt = new Date().toISOString()

  if (ttl > 0) {
    dumpCache = {
      refreshedAt,
      cachedAtMs: Date.now(),
      core,
    }
  } else {
    dumpCache = null
  }

  return {
    ok: true,
    refreshedAt,
    fromCache: false,
    cacheTtlMs: ttl,
    staleAt: ttl > 0 ? new Date(Date.now() + ttl).toISOString() : null,
    ...core,
  }
}
