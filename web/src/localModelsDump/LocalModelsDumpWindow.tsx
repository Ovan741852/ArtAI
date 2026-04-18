import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckpointNameTags } from '../components/checkpoint/CheckpointNameTags'
import {
  CatalogSyncFromComfyReq,
  CatalogSyncFromComfyRsp,
  LocalModelsDumpReq,
  LocalModelsDumpRsp,
  createDefaultHttpClient,
  type LocalModelsDumpData,
} from '../net'

import './localModelsDump.css'

const client = createDefaultHttpClient()

type CatalogEntry = LocalModelsDumpData['sources']['checkpointCatalog']['entries'][number]

function catalogEntryTags(e: CatalogEntry): string[] {
  return e.civitaiTags ?? []
}

function catalogEntryDesc(e: CatalogEntry): string {
  return e.civitaiDescriptionPreview ?? ''
}

function catalogEntryTrained(e: CatalogEntry): string[] {
  return e.civitaiTrainedWords ?? []
}

type CheckpointSummaryModal = {
  filename: string
  modelName: string | null
  description: string
  trainedWords: string[]
  baseModel: string | null
  creator: string | null
}

export function LocalModelsDumpWindow() {
  const [data, setData] = useState<LocalModelsDumpData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [ckModal, setCkModal] = useState<CheckpointSummaryModal | null>(null)
  const loadGenRef = useRef(0)

  const catalogByFilename = useMemo(() => {
    const m = new Map<string, CatalogEntry>()
    for (const e of data?.sources.checkpointCatalog.entries ?? []) {
      m.set(e.localFilename, e)
    }
    return m
  }, [data])

  const load = useCallback(async (force: boolean) => {
    const myLoad = ++loadGenRef.current
    setLoading(true)
    setError(null)
    const res = await client.sendRequest(LocalModelsDumpReq.allocate(force), LocalModelsDumpRsp)
    if (myLoad !== loadGenRef.current) return
    setLoading(false)
    if (!res.ok) {
      setData(null)
      setError(res.error.message)
      return
    }
    const packet = res.data
    if (!packet.ok || !packet.data) {
      setData(null)
      setError('回應格式異常')
      return
    }
    setData(packet.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void load(false)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const onRefresh = useCallback(() => {
    void load(true)
  }, [load])

  const onSyncCatalog = useCallback(async () => {
    setSyncLoading(true)
    setSyncNotice(null)
    const res = await client.sendRequest(CatalogSyncFromComfyReq.allocate(), CatalogSyncFromComfyRsp)
    setSyncLoading(false)
    if (!res.ok) {
      setSyncNotice(`同步失敗：${res.error.message}`)
      return
    }
    const packet = res.data
    if (!packet.ok) {
      setSyncNotice(`同步失敗：${packet.message}`)
      return
    }
    const failHint =
      packet.failures.length > 0
        ? ` 失敗 ${String(packet.failures.length)} 筆（例：${packet.failures[0]?.localFilename ?? ''}）。`
        : ''
    setSyncNotice(
      `同步完成：Comfy ${String(packet.comfyCheckpointCount)} 個檔 → 目錄寫入 ${String(packet.persistedCount)} 筆，` +
        `新拉 Civitai ${String(packet.refreshedCount)} 筆、保留舊筆 ${String(packet.staleKeptCount)} 筆。${failHint}`,
    )
    await load(true)
  }, [load])

  useEffect(() => {
    if (!ckModal) return
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') setCkModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ckModal])

  const closeModal = useCallback(() => setCkModal(null), [])

  return (
    <div className="dump">
      <header className="dump__head">
        <h2 className="dump__title">本機模型彙整</h2>
        <button type="button" className="dump__refresh" disabled={loading || syncLoading} onClick={onRefresh}>
          {loading ? '載入中…' : '重新整理'}
        </button>
        {data ? (
          <div className="dump__meta">
            <span>
              快照時間 <code>{data.refreshedAt}</code>
            </span>
            {data.fromCache ? <span className="dump__badge">快取</span> : null}
            <span>
              {' '}
              · Comfy {data.summary.comfyCheckpointCount} · Ollama {data.summary.ollamaModelCount} · Catalog{' '}
              {data.summary.catalogEntryCount}
            </span>
          </div>
        ) : null}
        <p className="dump__hint">
          Refresh skips server dump cache and re-reads Comfy / Ollama / catalog JSON. Tags and description come from
          Civitai (mostly English).
        </p>
      </header>

      {error ? <div className="dump__err">{error}</div> : null}

      {data ? (
        <>
          <section className="dump__block">
            <h2>ComfyUI checkpoints</h2>
            {!data.sources.comfyui.ok ? (
              <p className="dump__warn">無法取得：{data.sources.comfyui.error ?? '未知錯誤'}</p>
            ) : data.sources.comfyui.checkpoints.length === 0 ? (
              <p className="dump__empty">（無檔案）</p>
            ) : (
              <ol className="dump__list dump__list--tall dump__list--ck">
                {data.sources.comfyui.checkpoints.map((name) => {
                  const cat = catalogByFilename.get(name)
                  const tags = cat ? catalogEntryTags(cat) : []
                  const desc = cat ? catalogEntryDesc(cat) : ''
                  const trained = cat ? catalogEntryTrained(cat) : []
                  const canModal = Boolean(cat)
                  return (
                    <li key={name}>
                      <div className="dump__ck-row">
                        <div className="dump__ck-tags-wrap">
                          <CheckpointNameTags
                            className="dump__ck-cknt"
                            name={name}
                            tags={tags}
                            emptyHint={
                              cat
                                ? '(no tags)'
                                : '（無目錄條目 — 至下方「Checkpoint 目錄」按「同步 checkpoint 目錄」）'
                            }
                            trailing={
                              <button
                                type="button"
                                className="dump__ck-summary-btn"
                                disabled={!canModal}
                                title={
                                  canModal
                                    ? 'Open Civitai description & metadata'
                                    : 'Sync catalog below to attach Civitai metadata'
                                }
                                onClick={() => {
                                  if (!cat) return
                                  setCkModal({
                                    filename: name,
                                    modelName: cat.civitaiModelName ?? null,
                                    description: desc,
                                    trainedWords: trained,
                                    baseModel: cat.civitaiBaseModel ?? null,
                                    creator: cat.civitaiCreatorUsername ?? null,
                                  })
                                }}
                              >
                                Summary
                              </button>
                            }
                          />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            <p className="dump__sub">{data.sources.comfyui.baseUrl}</p>
          </section>

          <section className="dump__block">
            <h2>Ollama 已安裝</h2>
            {!data.sources.ollama.ok ? (
              <p className="dump__warn">無法取得：{data.sources.ollama.error ?? '未知錯誤'}</p>
            ) : data.sources.ollama.modelNames.length === 0 ? (
              <p className="dump__empty">（無模型）</p>
            ) : (
              <ol className="dump__list">
                {data.sources.ollama.modelNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ol>
            )}
            <p className="dump__sub">{data.sources.ollama.baseUrl}</p>
          </section>

          <section className="dump__block">
            <div className="dump__block-toolbar">
              <h2>Checkpoint 目錄（Civitai 同步）</h2>
              <button
                type="button"
                className="dump__sync"
                disabled={loading || syncLoading || !data.sources.comfyui.ok}
                title={
                  !data.sources.comfyui.ok
                    ? '無法連到 ComfyUI，無法同步'
                    : '向 Comfy 取 checkpoint 清單並寫入本機 JSON（POST /catalog/checkpoints/sync-from-comfy）'
                }
                onClick={() => {
                  void onSyncCatalog()
                }}
              >
                {syncLoading ? '同步中…' : '同步 checkpoint 目錄'}
              </button>
            </div>
            {syncNotice ? <p className="dump__sync-notice">{syncNotice}</p> : null}
            <p className="dump__sub">
              {data.sources.checkpointCatalog.storePath}
              {data.sources.checkpointCatalog.catalogUpdatedAt
                ? ` · 更新 ${data.sources.checkpointCatalog.catalogUpdatedAt}`
                : ''}
            </p>
            {data.sources.checkpointCatalog.entries.length === 0 ? (
              <p className="dump__empty">
                （尚無條目）若 Comfy 已有 checkpoints，可按上方「同步 checkpoint 目錄」建立 JSON。
              </p>
            ) : (
              <div className="dump__entries">
                {data.sources.checkpointCatalog.entries.map((e) => {
                  const tags = catalogEntryTags(e)
                  const desc = catalogEntryDesc(e)
                  const trained = catalogEntryTrained(e)
                  return (
                    <article key={`${e.localFilename}-${e.civitaiModelId}`} className="dump__entry">
                      <CheckpointNameTags
                        className="dump__entry-cknt"
                        name={e.localFilename}
                        tags={tags}
                        caption={e.civitaiModelName ? `— ${e.civitaiModelName}` : null}
                        emptyHint="(no tags)"
                      />
                      {e.civitaiCreatorUsername ? (
                        <p className="dump__entry-meta">
                          <span className="dump__label-en">Creator</span> {e.civitaiCreatorUsername}
                        </p>
                      ) : null}
                      {e.civitaiBaseModel ? (
                        <p className="dump__entry-meta">
                          <span className="dump__label-en">Base model</span> {e.civitaiBaseModel}
                        </p>
                      ) : null}
                      {trained.length > 0 ? (
                        <p className="dump__entry-meta">
                          <span className="dump__label-en">Trained words</span> {trained.join(', ')}
                        </p>
                      ) : null}
                      <div className="dump__entry-descblock">
                        <span className="dump__label-en">Description (Civitai, usually EN)</span>
                        {desc ? (
                          <p className="dump__entry-desc">{desc}</p>
                        ) : (
                          <p className="dump__muted">(no description)</p>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      ) : !error && loading ? (
        <p className="dump__empty">向後端取得 /models/local/dump …</p>
      ) : null}

      {ckModal ? (
        <div className="dump__modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="dump__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dump-modal-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <header className="dump__modal-head">
              <h3 id="dump-modal-title" className="dump__modal-title">
                {ckModal.filename}
              </h3>
              <button type="button" className="dump__modal-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </header>
            {ckModal.modelName ? (
              <p className="dump__modal-sub">{ckModal.modelName}</p>
            ) : null}
            <div className="dump__modal-body">
              {ckModal.creator ? (
                <p className="dump__modal-meta">
                  <span className="dump__label-en">Creator</span> {ckModal.creator}
                </p>
              ) : null}
              {ckModal.baseModel ? (
                <p className="dump__modal-meta">
                  <span className="dump__label-en">Base model</span> {ckModal.baseModel}
                </p>
              ) : null}
              {ckModal.trainedWords.length > 0 ? (
                <p className="dump__modal-meta">
                  <span className="dump__label-en">Trained words</span> {ckModal.trainedWords.join(', ')}
                </p>
              ) : null}
              <p className="dump__label-en dump__modal-seclabel">Description (Civitai)</p>
              {ckModal.description ? (
                <pre className="dump__modal-desc">{ckModal.description}</pre>
              ) : (
                <p className="dump__muted">(no description in catalog)</p>
              )}
            </div>
            <footer className="dump__modal-foot">
              <button type="button" className="dump__modal-done" onClick={closeModal}>
                Close
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
