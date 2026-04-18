import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AssistantResourceExtras } from '../components/assistant/AssistantResourceExtras'
import { CheckpointNameTags } from '../components/checkpoint/CheckpointNameTags'
import { resolveRecommendedLocalPresence } from '../components/checkpoint/checkpointLocalPresence'
import {
  LocalModelsDumpReq,
  LocalModelsDumpRsp,
  OllamaModelsReq,
  OllamaModelsRsp,
  createDefaultHttpClient,
  postCheckpointTagAssistantChatStream,
  type AssistantResourceExtraOk,
  type CheckpointTagAssistantMessage,
  type CheckpointTagAssistantOkData,
} from '../net'

import { CheckpointTagAssistantLocalCheckpoints } from './CheckpointTagAssistantLocalCheckpoints'
import { splitStreamForDisplay } from './streamDisplay'
import './checkpointTagAssistant.css'

const client = createDefaultHttpClient()

const MAX_IMAGE_FILE_BYTES = 6 * 1024 * 1024

const MEMORY_RESET_TIP_MS = 4500

type PendingImage = {
  dataUrl: string
  base64: string
}

type CivitaiRec = CheckpointTagAssistantOkData['recommendedModels'][number]

type SearchHistoryEntry = {
  id: string
  /** ISO 8601 */
  at: string
  modelTags: string[]
  searchQueries: string[]
  recommendedModels: CivitaiRec[]
  resourceExtras: AssistantResourceExtraOk[]
}

type SentImageEntry = {
  id: string
  dataUrl: string
}

function newHistoryId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID()
  }
  return `${String(Date.now())}-${String(Math.random()).slice(2, 10)}`
}

function formatSearchTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'medium' })
  } catch {
    return iso
  }
}

type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
  /** 若為 true，之後送 API 時此則 user 改為空字串（僅該輪曾帶 imageBase64）。 */
  wasImageOnly?: boolean
  userImageDataUrl?: string
  /** Ollama 串流中（尚未收到 final）。 */
  streaming?: boolean
  streamRaw?: string
  detail?: Pick<CheckpointTagAssistantOkData['assistant'], 'modelTags' | 'searchQueries'> & {
    recommendedModels: CheckpointTagAssistantOkData['recommendedModels']
    /** 對應右欄快取 `searchHistory` 同一筆 id。 */
    historyId: string
  }
}

const STREAM_OPEN_CAP = 420

function StreamingStreamBody({ raw }: { raw: string }) {
  const { closed, open } = useMemo(() => splitStreamForDisplay(raw), [raw])
  const openShown = open.length > STREAM_OPEN_CAP ? `${open.slice(0, STREAM_OPEN_CAP)}…` : open
  return (
    <div className="cta__stream-prose" aria-busy="true">
      {closed ? <p className="cta__stream-closed">{closed}</p> : null}
      {open ? (
        <p className="cta__stream-open">
          {openShown}
          <span className="cta__stream-caret" aria-hidden />
        </p>
      ) : closed ? (
        <p className="cta__stream-open cta__stream-open--caretonly">
          <span className="cta__stream-caret" aria-hidden />
        </p>
      ) : (
        <p className="cta__stream-placeholder">正在整理回覆…</p>
      )}
    </div>
  )
}

export function CheckpointTagAssistantWindow() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resetTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [dumpLoading, setDumpLoading] = useState(true)
  const [dumpError, setDumpError] = useState<string | null>(null)
  const [localRows, setLocalRows] = useState<CheckpointTagAssistantOkData['localCheckpoints']>([])

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [imageErr, setImageErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [sentImageHistory, setSentImageHistory] = useState<SentImageEntry[]>([])
  const [memoryResetNotice, setMemoryResetNotice] = useState(false)

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
    if (res.ok === false) {
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
    if (res.ok === false) {
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

  useEffect(() => {
    if (searchHistory.length === 0) {
      setSelectedHistoryId(null)
      return
    }
    setSelectedHistoryId((prev) => {
      if (prev && searchHistory.some((h) => h.id === prev)) return prev
      return searchHistory[0].id
    })
  }, [searchHistory])

  useEffect(() => {
    return () => {
      if (resetTipTimerRef.current) clearTimeout(resetTipTimerRef.current)
    }
  }, [])

  const messagesForApi = useMemo((): CheckpointTagAssistantMessage[] => {
    return turns
      .filter((t) => !(t.role === 'assistant' && t.streaming))
      .map((t) => {
        if (t.role === 'user' && t.wasImageOnly) return { role: 'user', content: '' }
        return { role: t.role, content: t.content }
      })
  }, [turns])

  const selectedEntry = useMemo(() => {
    if (searchHistory.length === 0) return null
    const hit = selectedHistoryId ? searchHistory.find((h) => h.id === selectedHistoryId) : null
    return hit ?? searchHistory[0]
  }, [searchHistory, selectedHistoryId])

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

  const resetWorkspace = useCallback(() => {
    setTurns([])
    setDraft('')
    setPendingImage(null)
    setImageErr(null)
    setChatError(null)
    setSearchHistory([])
    setSelectedHistoryId(null)
    setSentImageHistory([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    setMemoryResetNotice(true)
    if (resetTipTimerRef.current) clearTimeout(resetTipTimerRef.current)
    resetTipTimerRef.current = setTimeout(() => {
      setMemoryResetNotice(false)
      resetTipTimerRef.current = null
    }, MEMORY_RESET_TIP_MS)
  }, [])

  const pickTurnHistory = useCallback((historyId: string | undefined) => {
    if (!historyId) return
    if (!searchHistory.some((h) => h.id === historyId)) return
    setSelectedHistoryId(historyId)
  }, [searchHistory])

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

    if (imgSnap?.dataUrl) {
      setSentImageHistory((prev) => [...prev, { id: newHistoryId(), dataUrl: imgSnap.dataUrl }])
    }

    setTurns((prev) => [
      ...prev,
      {
        role: 'user',
        content: userDisplay,
        wasImageOnly,
        userImageDataUrl: imgSnap?.dataUrl,
      },
      { role: 'assistant', content: '', streaming: true, streamRaw: '' },
    ])
    setSending(true)

    const streamBody: Record<string, unknown> = {
      messages: nextMessages,
      ollamaModel: ollamaPicked,
      recommendLimit: 6,
    }
    if (imgB64) streamBody.imageBase64 = imgB64

    try {
      const out = await postCheckpointTagAssistantChatStream(streamBody, {
        onDelta: (piece) => {
          setTurns((prev) => {
            const next = [...prev]
            const i = next.length - 1
            if (i < 0 || next[i].role !== 'assistant' || !next[i].streaming) return prev
            next[i] = { ...next[i], streamRaw: (next[i].streamRaw ?? '') + piece }
            return next
          })
        },
        onFinal: (d) => {
          const hid = newHistoryId()
          const entry: SearchHistoryEntry = {
            id: hid,
            at: new Date().toISOString(),
            modelTags: [...d.assistant.modelTags],
            searchQueries: [...d.assistant.searchQueries],
            recommendedModels: [...d.recommendedModels],
            resourceExtras: d.resourceExtras.map((x) => ({
              ...x,
              modelTags: [...x.modelTags],
              searchQueries: [...x.searchQueries],
              recommendedModels: [...x.recommendedModels],
            })),
          }
          setLocalRows(d.localCheckpoints)
          setSearchHistory((hist) => [entry, ...hist])
          setSelectedHistoryId(hid)
          setTurns((prev) => {
            const next = [...prev]
            const i = next.length - 1
            if (i < 0 || next[i].role !== 'assistant' || !next[i].streaming) return prev
            next[i] = {
              role: 'assistant',
              content: d.assistant.replyZh,
              detail: {
                modelTags: d.assistant.modelTags,
                searchQueries: d.assistant.searchQueries,
                recommendedModels: d.recommendedModels,
                historyId: hid,
              },
            }
            return next
          })
        },
      })
      if (out.ok === false) {
        setChatError(out.message)
        setTurns((prev) => prev.slice(0, -2))
        if (imgB64 && imgSnap?.dataUrl) {
          setSentImageHistory((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.dataUrl === imgSnap.dataUrl) return prev.slice(0, -1)
            return prev
          })
        }
        if (imgB64 && imgSnap) setPendingImage(imgSnap)
      }
    } finally {
      setSending(false)
    }
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
        左欄為對話與每輪結論的 tag；中欄送出需求與參考圖；右欄為該輪快取的 **Checkpoint** 與下方 **延伸資源**（LoRA／Embedding／ControlNet
        等條列；可連 Civitai 的會附連結）。點左欄某一輪的 tag 區塊可切換右欄（不重打 API）。
      </p>

      <div className="cta__grid">
        <div className="cta__col cta__col--left">
          <div className="cta__col-head">
            <button type="button" className="cta__reset" disabled={sending} onClick={resetWorkspace}>
              重置對話
            </button>
            {memoryResetNotice ? (
              <p className="cta__reset-tip" role="status">
                目前記憶已重置。
              </p>
            ) : (
              <p className="cta__col-hint">重置會清空本頁對話、待送內容、圖片紀錄與搜尋快取。</p>
            )}
          </div>

          <div className="cta__chat cta__chat--col" aria-live="polite">
            {turns.length === 0 ? (
              <p className="cta__hint cta__hint--inset">例如：想畫寫實人像；或丟一張風格參考圖，助手會整理英文 tag 並在右欄列出建議 checkpoint。</p>
            ) : null}
            {turns.map((t, i) => {
              const isPickableAssistant = t.role === 'assistant' && !t.streaming && t.detail?.historyId
              const isSelectedTurn = Boolean(t.detail?.historyId && t.detail.historyId === selectedHistoryId)
              return (
                <div
                  key={`turn-${String(i)}`}
                  className={`cta__bubble ${t.role === 'user' ? 'cta__bubble--user' : 'cta__bubble--assistant'}${isSelectedTurn ? ' cta__bubble--picked' : ''}`}
                >
                  {t.role === 'user' ? (
                    <>
                      {t.content ? <div className="cta__bubble-text">{t.content}</div> : null}
                      {t.userImageDataUrl ? (
                        <img className="cta__user-img" src={t.userImageDataUrl} alt="此則訊息附上的參考圖" />
                      ) : null}
                    </>
                  ) : t.streaming ? (
                    <StreamingStreamBody raw={t.streamRaw ?? ''} />
                  ) : (
                    <>
                      {t.detail ? (
                        <div
                          className={`cta__pick-turn${isPickableAssistant ? ' cta__pick-turn--active' : ''}`}
                          role={isPickableAssistant ? 'button' : undefined}
                          tabIndex={isPickableAssistant ? 0 : undefined}
                          onClick={() => pickTurnHistory(t.detail?.historyId)}
                          onKeyDown={(e) => {
                            if (!isPickableAssistant) return
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              pickTurnHistory(t.detail?.historyId)
                            }
                          }}
                          aria-label={isPickableAssistant ? '在右欄查看此輪搜尋結果' : undefined}
                        >
                          <CheckpointNameTags
                            className="cta__bubble-cknt"
                            name="此輪結論的 model tags"
                            showTitle={false}
                            tags={t.detail.modelTags}
                            caption={
                              t.detail.searchQueries.length > 0 ? (
                                <>Civitai name search: {t.detail.searchQueries.join(' · ')}</>
                              ) : null
                            }
                            emptyHint="(no tags)"
                          />
                          {isPickableAssistant ? <p className="cta__pick-hint">點此區可在右欄查看該輪搜尋（已快取）。</p> : null}
                        </div>
                      ) : null}
                      {t.content ? <p className="cta__bubble-reply">{t.content}</p> : null}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="cta__col cta__col--mid">
          <h3 className="cta__section-title cta__section-title--tight">輸入</h3>
          <div className="cta__form">
            <div className="cta__field">
              <label className="cta__label" htmlFor="cta-ollama-model">
                Ollama 模型
              </label>
              {ollamaError ? <p className="cta__err">{ollamaError}</p> : null}
              {ollamaLoading ? (
                <p className="cta__hint">讀取模型清單中…</p>
              ) : ollamaModelNames.length === 0 ? (
                <p className="cta__err">
                  沒有可用的 Ollama 模型。請確認 Ollama 已啟動，並執行過 <code className="cta__code">ollama pull</code>。
                </p>
              ) : (
                <select
                  id="cta-ollama-model"
                  className="cta__select"
                  value={ollamaPicked}
                  onChange={(e) => setOllamaPicked(e.target.value)}
                  disabled={sending}
                  aria-describedby={ollamaBaseUrl ? 'cta-ollama-hint' : undefined}
                >
                  {ollamaModelNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              {ollamaBaseUrl ? (
                <p id="cta-ollama-hint" className="cta__hint">
                  連線：{ollamaBaseUrl}
                  <br />
                  附圖分析請選<strong>視覺模型</strong>（如 <code className="cta__code">llava</code>）。
                </p>
              ) : null}
            </div>

            <div className="cta__field">
              <span className="cta__label">已送出的參考圖</span>
              {sentImageHistory.length === 0 ? (
                <p className="cta__hint">尚無；送出附圖訊息後會列在這裡。</p>
              ) : (
                <ul className="cta__img-hist" aria-label="此工作階段已送出的參考圖">
                  {sentImageHistory.map((it) => (
                    <li key={it.id} className="cta__img-hist-item">
                      <img className="cta__img-hist-thumb" src={it.dataUrl} alt="" />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="cta__field">
              <span className="cta__label">待送出參考圖</span>
              {imageErr ? <p className="cta__err">{imageErr}</p> : null}
              <div
                className="cta__drop cta__drop--compact"
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
                  移除待送圖
                </button>
              ) : null}
            </div>

            <label className="cta__label" htmlFor="cta-input">
              需求描述
            </label>
            <textarea
              id="cta-input"
              className="cta__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="描述風格、主題…（可留空若只送圖）"
              disabled={sending}
            />
            <div className="cta__actions">
              <button type="button" className="cta__send" disabled={!canSend} onClick={() => void send()}>
                {sending ? '處理中…' : '送出'}
              </button>
              <button
                type="button"
                className="cta__ghost"
                disabled={sending || dumpLoading || ollamaLoading}
                onClick={() => void refreshAll()}
              >
                重新載入本機清單
              </button>
            </div>
            {chatError ? <p className="cta__err cta__err--block">{chatError}</p> : null}
          </div>
        </div>

        <div className="cta__col cta__col--right">
          <h3 className="cta__section-title cta__section-title--tight">此輪搜尋（快取）</h3>
          {!selectedEntry ? (
            <p className="cta__hint">送出後，此處會顯示最新一輪的 tags 與 Civitai 結果。</p>
          ) : (
            <>
              <CheckpointNameTags
                className="cta__hist-tagblock"
                name="此輪用於搜尋的 model tags"
                showTitle={false}
                tags={selectedEntry.modelTags}
                caption={
                  selectedEntry.searchQueries.length > 0 ? (
                    <span>
                      <span className="cta__hist-queries-label">關鍵字搜尋</span> {selectedEntry.searchQueries.join(' · ')}
                    </span>
                  ) : null
                }
                emptyHint="(此輪無 tags)"
              />
              <p className="cta__hist-meta">
                <time dateTime={selectedEntry.at}>{formatSearchTime(selectedEntry.at)}</time>
              </p>
              {selectedEntry.recommendedModels.length > 0 ? (
                <div className="cta__rec cta__rec--scroll">
                  {selectedEntry.recommendedModels.map((m) => (
                    <div key={m.id} className="cta__rec-card">
                      <CheckpointNameTags
                        name={m.name}
                        tags={m.tags}
                        localPresence={resolveRecommendedLocalPresence(m.name, localRows)}
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
              ) : (
                <p className="cta__muted">此輪無結果</p>
              )}
              <AssistantResourceExtras extras={selectedEntry.resourceExtras} localRows={localRows} />
            </>
          )}
        </div>
      </div>

      <div className="cta__local-wide">
        <CheckpointTagAssistantLocalCheckpoints
          localRows={localRows}
          dumpLoading={dumpLoading}
          dumpError={dumpError}
        />
      </div>
    </section>
  )
}
