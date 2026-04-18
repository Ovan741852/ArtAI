import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { CheckpointNameTags } from '../components/checkpoint/CheckpointNameTags'
import {
  CheckpointTagAssistantChatReq,
  CheckpointTagAssistantChatRsp,
  LocalModelsDumpReq,
  LocalModelsDumpRsp,
  OllamaModelsReq,
  OllamaModelsRsp,
  createDefaultHttpClient,
  type CheckpointTagAssistantMessage,
  type CheckpointTagAssistantOkData,
} from '../net'

import './checkpointTagAssistant.css'

const client = createDefaultHttpClient()

const MAX_IMAGE_FILE_BYTES = 6 * 1024 * 1024

type PendingImage = {
  dataUrl: string
  base64: string
}

type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
  /** 若為 true，之後送 API 時此則 user 改為空字串（僅該輪曾帶 imageBase64）。 */
  wasImageOnly?: boolean
  userImageDataUrl?: string
  detail?: Pick<CheckpointTagAssistantOkData['assistant'], 'modelTags' | 'searchQueries'> & {
    recommendedModels: CheckpointTagAssistantOkData['recommendedModels']
  }
}

export function CheckpointTagAssistantWindow() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dumpLoading, setDumpLoading] = useState(true)
  const [dumpError, setDumpError] = useState<string | null>(null)
  const [localRows, setLocalRows] = useState<CheckpointTagAssistantOkData['localCheckpoints']>([])

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [imageErr, setImageErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const [ollamaLoading, setOllamaLoading] = useState(true)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [ollamaModelNames, setOllamaModelNames] = useState<string[]>([])
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('')
  const [ollamaPicked, setOllamaPicked] = useState('')

  const loadOllama = useCallback(async () => {
    setOllamaLoading(true)
    setOllamaError(null)
    const res = await client.sendRequest(OllamaModelsReq.allocate(), OllamaModelsRsp)
    setOllamaLoading(false)
    if (!res.ok) {
      setOllamaModelNames([])
      setOllamaBaseUrl('')
      setOllamaError(res.error.message)
      return
    }
    const p = res.data
    if (!p.ok || !p.data) {
      setOllamaModelNames([])
      setOllamaBaseUrl('')
      setOllamaError(p.message || '無法取得 Ollama 模型')
      return
    }
    setOllamaModelNames(p.data.modelNames.length > 0 ? p.data.modelNames : p.data.models.map((m) => m.name))
    setOllamaBaseUrl(p.data.ollamaBaseUrl)
    setOllamaError(null)
  }, [])

  useEffect(() => {
    const names = ollamaModelNames
    if (names.length === 0) return
    setOllamaPicked((prev) => (prev && names.includes(prev) ? prev : names[0]))
  }, [ollamaModelNames])

  const loadDump = useCallback(async () => {
    setDumpLoading(true)
    setDumpError(null)
    const res = await client.sendRequest(LocalModelsDumpReq.allocate(false), LocalModelsDumpRsp)
    setDumpLoading(false)
    if (!res.ok) {
      setLocalRows([])
      setDumpError(res.error.message)
      return
    }
    const p = res.data
    if (!p.ok || !p.data) {
      setLocalRows([])
      setDumpError('無法讀取本機模型清單')
      return
    }
    const cat = new Map(p.data.sources.checkpointCatalog.entries.map((e) => [e.localFilename, e]))
    const rows: CheckpointTagAssistantOkData['localCheckpoints'] = []
    for (const fn of p.data.sources.comfyui.checkpoints) {
      const e = cat.get(fn)
      rows.push({
        localFilename: fn,
        civitaiTags: e ? [...e.civitaiTags] : [],
        civitaiModelName: e?.civitaiModelName ?? null,
        inCatalog: Boolean(e),
      })
    }
    setLocalRows(rows)
    if (!p.data.sources.comfyui.ok) {
      setDumpError(p.data.sources.comfyui.error ?? '無法連到 ComfyUI')
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDump(), loadOllama()])
  }, [loadDump, loadOllama])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const messagesForApi = useMemo((): CheckpointTagAssistantMessage[] => {
    return turns.map((t) => {
      if (t.role === 'user' && t.wasImageOnly) return { role: 'user', content: '' }
      return { role: t.role, content: t.content }
    })
  }, [turns])

  const ingestImageFile = useCallback((file: File | null) => {
    setImageErr(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setImageErr('請選擇圖片檔（image/*）。')
      return
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setImageErr(`圖片請小於 ${String(Math.floor(MAX_IMAGE_FILE_BYTES / 1024 / 1024))} MB。`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const comma = dataUrl.indexOf(',')
      const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
      if (!b64) {
        setImageErr('無法讀取圖片內容。')
        return
      }
      setPendingImage({ dataUrl, base64: b64 })
    }
    reader.onerror = () => setImageErr('讀取圖片失敗。')
    reader.readAsDataURL(file)
  }, [])

  const clearPendingImage = useCallback(() => {
    setPendingImage(null)
    setImageErr(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const send = useCallback(async () => {
    const text = draft.trim()
    const imgSnap = pendingImage
    const imgB64 = imgSnap?.base64 ?? null
    if ((!text && !imgB64) || sending) return
    setChatError(null)

    const userDisplay = text || '（已附參考圖）'
    const wasImageOnly = Boolean(imgB64 && !text)

    const nextMessages: CheckpointTagAssistantMessage[] = [...messagesForApi, { role: 'user', content: wasImageOnly ? '' : text }]

    setDraft('')
    setPendingImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''

    setTurns((prev) => [
      ...prev,
      {
        role: 'user',
        content: userDisplay,
        wasImageOnly,
        userImageDataUrl: imgSnap?.dataUrl,
      },
    ])
    setSending(true)

    const res = await client.sendRequest(
      CheckpointTagAssistantChatReq.allocate(nextMessages, {
        ollamaModel: ollamaPicked,
        recommendLimit: 6,
        imageBase64: imgB64 ?? undefined,
      }),
      CheckpointTagAssistantChatRsp,
    )
    setSending(false)

    if (!res.ok) {
      setChatError(res.error.message)
      setTurns((prev) => prev.slice(0, -1))
      if (imgB64 && imgSnap) setPendingImage(imgSnap)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setChatError(res.data.message || '助手回應異常')
      setTurns((prev) => prev.slice(0, -1))
      if (imgB64 && imgSnap) setPendingImage(imgSnap)
      return
    }
    const d = res.data.data
    setLocalRows(d.localCheckpoints)
    setTurns((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: d.assistant.replyZh,
        detail: {
          modelTags: d.assistant.modelTags,
          searchQueries: d.assistant.searchQueries,
          recommendedModels: d.recommendedModels,
        },
      },
    ])
  }, [draft, messagesForApi, ollamaPicked, pendingImage, sending])

  const onDrop = useCallback(
    (ev: DragEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const f = ev.dataTransfer.files?.[0]
      ingestImageFile(f ?? null)
    },
    [ingestImageFile],
  )

  const canSend = Boolean(ollamaPicked && ollamaModelNames.length > 0 && (draft.trim() || pendingImage) && !sending)

  return (
    <section className="cta" aria-labelledby="cta-title">
      <h2 id="cta-title" className="cta__title">
        Checkpoint 需求助手
      </h2>
      <p className="cta__lead">
        用文字描述、或<strong>上傳一張參考圖</strong>；助手會用繁中回覆，並整理英文 Civitai 風格 tag 與熱門 checkpoint 參考。會一併參考你電腦上 Comfy 目錄裡的檔名與已同步的 tags。模型清單來自{' '}
        <code className="cta__code">GET /ollama/models</code>。
      </p>

      <h3 className="cta__section-title">本機 checkpoints</h3>
      {dumpError ? <p className="cta__err">{dumpError}</p> : null}
      <div className="cta__locals">
        {dumpLoading ? (
          <p className="cta__lead">載入清單中…</p>
        ) : localRows.length === 0 ? (
          <p className="cta__lead">目前沒有從 Comfy 讀到 checkpoint 檔；請確認後端已設定 Comfy 位址，或先到「本機模型彙整」同步目錄。</p>
        ) : (
          localRows.map((row) => (
            <div key={row.localFilename} className="cta__local-row">
              <CheckpointNameTags
                name={row.localFilename}
                tags={row.civitaiTags}
                caption={row.civitaiModelName ? `Civitai：${row.civitaiModelName}` : null}
                emptyHint={
                  row.inCatalog ? '(no tags in catalog)' : '（尚未寫入目錄 — 可到本機模型彙整按「同步 checkpoint 目錄」）'
                }
              />
              {!row.inCatalog ? <p className="cta__local-meta">Not in synced catalog</p> : null}
            </div>
          ))
        )}
      </div>

      <h3 className="cta__section-title">對話</h3>
      <div className="cta__chat" aria-live="polite">
        {turns.length === 0 ? (
          <p className="cta__lead">例如：想畫寫實人像；或丟一張風格參考圖讓助手推斷適合的 checkpoint 方向。</p>
        ) : null}
        {turns.map((t, i) => (
          <div
            key={`turn-${String(i)}`}
            className={`cta__bubble ${t.role === 'user' ? 'cta__bubble--user' : 'cta__bubble--assistant'}`}
          >
            {t.content ? <div className="cta__bubble-text">{t.content}</div> : null}
            {t.role === 'user' && t.userImageDataUrl ? (
              <img className="cta__user-img" src={t.userImageDataUrl} alt="使用者上傳的參考圖" />
            ) : null}
            {t.role === 'assistant' && t.detail ? (
              <>
                <div className="cta__bubble-tags" aria-label="Suggested Civitai model tags (English)">
                  {t.detail.modelTags.map((x) => (
                    <span key={x} className="cta__bubble-tag">
                      {x}
                    </span>
                  ))}
                </div>
                {t.detail.searchQueries.length > 0 ? (
                  <p className="cta__local-meta" style={{ marginTop: 6 }}>
                    Civitai name search: {t.detail.searchQueries.join(' · ')}
                  </p>
                ) : null}
              </>
            ) : null}
            {t.role === 'assistant' && t.detail && t.detail.recommendedModels.length > 0 ? (
              <div className="cta__rec">
                <strong className="cta__section-title">Civitai 參考（熱門 Checkpoint）</strong>
                {t.detail.recommendedModels.map((m) => (
                  <div key={m.id} className="cta__rec-card">
                    <CheckpointNameTags
                      name={m.name}
                      tags={m.tags}
                      emptyHint="(no tags)"
                      caption={
                        <a href={m.civitaiUrl} target="_blank" rel="noreferrer">
                          Civitai · #{m.id}
                        </a>
                      }
                    />
                    {m.descriptionText ? <p className="cta__rec-desc">{m.descriptionText}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {chatError ? <p className="cta__err">{chatError}</p> : null}

      <div className="cta__form">
        <div className="cta__field">
          <label className="cta__lead" htmlFor="cta-ollama-model">
            Ollama 模型（本機已安裝）
          </label>
          {ollamaError ? <p className="cta__err">{ollamaError}</p> : null}
          {ollamaLoading ? (
            <p className="cta__lead">讀取 Ollama 模型清單中…</p>
          ) : ollamaModelNames.length === 0 ? (
            <p className="cta__err">
              沒有可用的 Ollama 模型。請確認 Ollama 已啟動，並在本機執行過 <code className="cta__code">ollama pull</code> 安裝至少一個模型。
            </p>
          ) : (
            <select
              id="cta-ollama-model"
              className="cta__select"
              value={ollamaPicked}
              onChange={(e) => setOllamaPicked(e.target.value)}
              disabled={sending}
              aria-describedby="cta-ollama-hint"
            >
              {ollamaModelNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {ollamaBaseUrl ? (
            <p id="cta-ollama-hint" className="cta__local-meta">
              後端連線位址：{ollamaBaseUrl}
              <br />
              若<strong>附圖</strong>分析，請選<strong>支援視覺</strong>的模型（例如 <code className="cta__code">llava</code>、<code className="cta__code">llava:latest</code>）；純文字則一般對話模型即可。
            </p>
          ) : null}
        </div>

        <div className="cta__field">
          <span className="cta__lead">參考圖（選填）</span>
          <p className="cta__local-meta">拖放圖片到此，或點選選檔。可與下方文字同時送出。</p>
          {imageErr ? <p className="cta__err">{imageErr}</p> : null}
          <div
            className="cta__drop"
            role="button"
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={onDrop}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            {pendingImage ? (
              <img className="cta__drop-preview" src={pendingImage.dataUrl} alt="待送出參考圖預覽" />
            ) : (
              <span className="cta__drop-placeholder">點此或拖放圖片</span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="cta__file-input"
            aria-label="選擇參考圖"
            onChange={(e) => ingestImageFile(e.target.files?.[0] ?? null)}
          />
          {pendingImage ? (
            <button type="button" className="cta__ghost" onClick={clearPendingImage}>
              移除圖片
            </button>
          ) : null}
        </div>

        <label className="cta__lead" htmlFor="cta-input">
          你的需求（可只送圖、只送文字、或兩者一起）
        </label>
        <textarea
          id="cta-input"
          className="cta__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="描述風格、主題、用途…（可留空若只送圖）"
          disabled={sending}
        />
        <div className="cta__actions">
          <button type="button" className="cta__send" disabled={!canSend} onClick={() => void send()}>
            {sending ? '思考中…' : '送出'}
          </button>
          <button
            type="button"
            className="cta__ghost"
            disabled={sending || dumpLoading || ollamaLoading}
            onClick={() => void refreshAll()}
          >
            重新載入清單
          </button>
        </div>
      </div>
    </section>
  )
}
