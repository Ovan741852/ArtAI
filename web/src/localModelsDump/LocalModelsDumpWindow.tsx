import { useCallback, useEffect, useState } from 'react'
import {
  LocalModelsDumpReq,
  LocalModelsDumpRsp,
  createDefaultHttpClient,
  type LocalModelsDumpData,
} from '../net'

import './localModelsDump.css'

const client = createDefaultHttpClient()

export function LocalModelsDumpWindow() {
  const [data, setData] = useState<LocalModelsDumpData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    setError(null)
    const res = await client.sendRequest(LocalModelsDumpReq.allocate(force), LocalModelsDumpRsp)
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

  return (
    <div className="dump">
      <header className="dump__head">
        <h2 className="dump__title">本機模型彙整</h2>
        <button type="button" className="dump__refresh" disabled={loading} onClick={onRefresh}>
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
              · Comfy {data.summary.comfyCheckpointCount} · Ollama {data.summary.ollamaModelCount} · 目錄{' '}
              {data.summary.catalogEntryCount}
            </span>
          </div>
        ) : null}
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
              <ol className="dump__list">
                {data.sources.comfyui.checkpoints.map((name) => (
                  <li key={name}>{name}</li>
                ))}
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
            <h2>Checkpoint 目錄（Civitai 同步）</h2>
            <p className="dump__sub">
              {data.sources.checkpointCatalog.storePath}
              {data.sources.checkpointCatalog.catalogUpdatedAt
                ? ` · 更新 ${data.sources.checkpointCatalog.catalogUpdatedAt}`
                : ''}
            </p>
            {data.sources.checkpointCatalog.entries.length === 0 ? (
              <p className="dump__empty">（無條目）</p>
            ) : (
              <ol className="dump__list">
                {data.sources.checkpointCatalog.entries.map((e) => (
                  <li key={`${e.localFilename}-${e.civitaiModelId}`}>
                    {e.localFilename}
                    {e.civitaiModelName ? ` — ${e.civitaiModelName}` : ''}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : !error && loading ? (
        <p className="dump__empty">向後端取得 /models/local/dump …</p>
      ) : null}
    </div>
  )
}
