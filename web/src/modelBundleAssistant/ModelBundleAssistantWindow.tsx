import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { CheckpointNameTags } from '../components/checkpoint/CheckpointNameTags'
import { splitStreamForDisplay } from '../checkpointTagAssistant/streamDisplay'
import {
  OllamaModelsReq,
  OllamaModelsRsp,
  createDefaultHttpClient,
  postModelBundleAssistantChatStream,
  type ModelBundleAssistantBundleOk,
  type ModelBundleAssistantMessage,
} from '../net'

import './modelBundleAssistant.css'

const client = createDefaultHttpClient()

const MAX_IMAGE_FILE_BYTES = 6 * 1024 * 1024
const MEMORY_RESET_TIP_MS = 4500
const STREAM_OPEN_CAP = 420

type PendingImage = {
  dataUrl: string
  base64: string
}

type BundleHistoryEntry = {
  id: string
  at: string
  bundles: ModelBundleAssistantBundleOk[]
  replyZh: string
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

type ChatTurn =
  | {
      role: 'user'
      content: string
      wasImageOnly?: boolean
      userImageDataUrl?: string
    }
  | {
      role: 'assistant'
      content: string
      streaming?: boolean
      streamRaw?: string
      detail?: {
        bundles: ModelBundleAssistantBundleOk[]
        replyZh: string
        historyId: string
      }
    }

function MbaStreamingBody({ raw }: { raw: string }) {
  const { closed, open } = useMemo(() => splitStreamForDisplay(raw), [raw])
  const openShown = open.length > STREAM_OPEN_CAP ? `${open.slice(0, STREAM_OPEN_CAP)}…` : open
  return (
    <div className="mba__stream-prose" aria-busy="true">
      {closed ? <p className="mba__stream-closed">{closed}</p> : null}
      {open ? (
        <p className="mba__stream-open">
          {openShown}
          <span className="mba__stream-caret" aria-hidden />
        </p>
      ) : closed ? (
        <p className="mba__stream-open mba__stream-open--caretonly">
          <span className="mba__stream-caret" aria-hidden />
        </p>
      ) : (
        <p className="mba__stream-placeholder">正在整理回覆…</p>
      )}
    </div>
  )
}

function renderSlotSection(
  label: string,
  slot: ModelBundleAssistantBundleOk['checkpoint'],
  keyPrefix: string,
) {
  return (
    <div key={keyPrefix}>
      <p className="mba__slot-label">{label}</p>
      <CheckpointNameTags
        className="mba__hist-tagblock"
        name={`${label} 搜尋用 tags`}
        showTitle={false}
        tags={slot.modelTags}
        caption={
          slot.searchQueries.length > 0 ? <>Civitai name search: {slot.searchQueries.join(' · ')}</> : null
        }
        emptyHint="(no tags)"
      />
      {slot.recommendedModels.length > 0 ? (
        <div className="mba__rec">
          {slot.recommendedModels.map((m) => (
            <div key={m.id} className="mba__rec-card">
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
              {m.descriptionText ? <p className="mba__rec-desc">{m.descriptionText}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mba__muted">此 slot 無結果</p>
      )}
    </div>
  )
}

export function ModelBundleAssistantWindow() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resetTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [imageErr, setImageErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [bundleHistory, setBundleHistory] = useState<BundleHistoryEntry[]>([])
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
    void loadOllama()
  }, [loadOllama])

  useEffect(() => {
    const names = ollamaModelNames
    if (names.length === 0) return
    setOllamaPicked((prev) => (prev && names.includes(prev) ? prev : names[0]))
  }, [ollamaModelNames])

  useEffect(() => {
    if (bundleHistory.length === 0) {
      setSelectedHistoryId(null)
      return
    }
    setSelectedHistoryId((prev) => {
      if (prev && bundleHistory.some((h) => h.id === prev)) return prev
      return bundleHistory[0].id
    })
  }, [bundleHistory])

  useEffect(() => {
    return () => {
      if (resetTipTimerRef.current) clearTimeout(resetTipTimerRef.current)
    }
  }, [])

  const messagesForApi = useMemo((): ModelBundleAssistantMessage[] => {
    return turns
      .filter((t) => !(t.role === 'assistant' && t.streaming))
      .map((t) => {
        if (t.role === 'user' && t.wasImageOnly) return { role: 'user', content: '' }
        if (t.role === 'user') return { role: 'user', content: t.content }
        return { role: 'assistant', content: t.content }
      })
  }, [turns])

  const selectedEntry = useMemo(() => {
    if (bundleHistory.length === 0) return null
    const hit = selectedHistoryId ? bundleHistory.find((h) => h.id === selectedHistoryId) : null
    return hit ?? bundleHistory[0]
  }, [bundleHistory, selectedHistoryId])

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
    setBundleHistory([])
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

  const pickTurnHistory = useCallback(
    (historyId: string | undefined) => {
      if (!historyId) return
      if (!bundleHistory.some((h) => h.id === historyId)) return
      setSelectedHistoryId(historyId)
    },
    [bundleHistory],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    const imgSnap = pendingImage
    const imgB64 = imgSnap?.base64 ?? null
    if ((!text && !imgB64) || sending) return
    setChatError(null)

    const userDisplay = text || '（已附參考圖）'
    const wasImageOnly = Boolean(imgB64 && !text)

    const nextMessages: ModelBundleAssistantMessage[] = [
      ...messagesForApi,
      { role: 'user', content: wasImageOnly ? '' : text },
    ]

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
      recommendLimitPerSlot: 4,
    }
    if (imgB64) streamBody.imageBase64 = imgB64

    try {
      const out = await postModelBundleAssistantChatStream(streamBody, {
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
          const entry: BundleHistoryEntry = {
            id: hid,
            at: new Date().toISOString(),
            bundles: d.bundles.map((b) => ({ ...b, loras: b.loras.map((x) => ({ ...x })) })),
            replyZh: d.assistant.replyZh,
          }
          setBundleHistory((hist) => [entry, ...hist])
          setSelectedHistoryId(hid)
          setTurns((prev) => {
            const next = [...prev]
            const i = next.length - 1
            if (i < 0 || next[i].role !== 'assistant' || !next[i].streaming) return prev
            next[i] = {
              role: 'assistant',
              content: d.assistant.replyZh,
              detail: {
                bundles: d.bundles,
                replyZh: d.assistant.replyZh,
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
    <section className="mba" aria-labelledby="mba-title">
      <h2 id="mba-title" className="mba__title">
        模型套組採購助手
      </h2>
      <p className="mba__lead">
        與「Checkpoint 需求助手」分開：此處一次整理最多三組「底模 Checkpoint + 可選 LoRA」的 Civitai
        搜尋結果，方便依需求下載。左欄為對話與每輪套組標題；中欄輸入與參考圖；右欄為該輪快取結果（點左欄該輪不重打
        API）。
      </p>

      <div className="mba__grid">
        <div className="mba__col mba__col--left">
          <div className="mba__col-head">
            <button type="button" className="mba__reset" disabled={sending} onClick={resetWorkspace}>
              重置對話
            </button>
            {memoryResetNotice ? (
              <p className="mba__reset-tip" role="status">
                目前記憶已重置。
              </p>
            ) : (
              <p className="mba__col-hint">重置會清空本頁對話、待送內容、圖片紀錄與結果快取。</p>
            )}
          </div>

          <div className="mba__chat" aria-live="polite">
            {turns.length === 0 ? (
              <p className="mba__hint">
                例如：想畫 UI 風格插畫、或角色同人；助手會回繁中短句，並在右欄列出最多三組採購向模型建議。
              </p>
            ) : null}
            {turns.map((t, i) => {
              const assistantDetail = t.role === 'assistant' ? t.detail : undefined
              const isPickableAssistant = t.role === 'assistant' && !t.streaming && Boolean(assistantDetail?.historyId)
              const isSelectedTurn = Boolean(
                assistantDetail?.historyId && assistantDetail.historyId === selectedHistoryId,
              )
              return (
                <div
                  key={`mba-turn-${String(i)}`}
                  className={`mba__bubble ${t.role === 'user' ? 'mba__bubble--user' : 'mba__bubble--assistant'}${isSelectedTurn ? ' mba__bubble--picked' : ''}`}
                >
                  {t.role === 'user' ? (
                    <>
                      {t.content ? <div className="mba__bubble-text">{t.content}</div> : null}
                      {t.userImageDataUrl ? (
                        <img className="mba__user-img" src={t.userImageDataUrl} alt="此則訊息附上的參考圖" />
                      ) : null}
                    </>
                  ) : t.streaming ? (
                    <MbaStreamingBody raw={t.streamRaw ?? ''} />
                  ) : (
                    <>
                      {assistantDetail ? (
                        <div
                          className={`mba__pick-turn${isPickableAssistant ? ' mba__pick-turn--active' : ''}`}
                          role={isPickableAssistant ? 'button' : undefined}
                          tabIndex={isPickableAssistant ? 0 : undefined}
                          onClick={() => pickTurnHistory(assistantDetail.historyId)}
                          onKeyDown={(e) => {
                            if (!isPickableAssistant) return
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              pickTurnHistory(assistantDetail.historyId)
                            }
                          }}
                          aria-label={isPickableAssistant ? '在右欄查看此輪套組結果' : undefined}
                        >
                          <ul className="mba__bundle-titles">
                            {assistantDetail.bundles.map((b, j) => (
                              <li key={`${assistantDetail.historyId}-b-${String(j)}`}>{b.titleZh}</li>
                            ))}
                          </ul>
                          {isPickableAssistant ? <p className="mba__pick-hint">點此區可在右欄查看該輪快取。</p> : null}
                        </div>
                      ) : null}
                      {t.content ? <p className="mba__bubble-reply">{t.content}</p> : null}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="mba__col mba__col--mid">
          <h3 className="mba__section-title mba__section-title--tight">輸入</h3>
          <div className="mba__form">
            <div className="mba__field">
              <label className="mba__label" htmlFor="mba-ollama-model">
                Ollama 模型
              </label>
              {ollamaError ? <p className="mba__err">{ollamaError}</p> : null}
              {ollamaLoading ? (
                <p className="mba__hint">讀取模型清單中…</p>
              ) : ollamaModelNames.length === 0 ? (
                <p className="mba__err">
                  沒有可用的 Ollama 模型。請確認 Ollama 已啟動，並執行過 <code className="mba__code">ollama pull</code>。
                </p>
              ) : (
                <select
                  id="mba-ollama-model"
                  className="mba__select"
                  value={ollamaPicked}
                  onChange={(e) => setOllamaPicked(e.target.value)}
                  disabled={sending}
                  aria-describedby={ollamaBaseUrl ? 'mba-ollama-hint' : undefined}
                >
                  {ollamaModelNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              {ollamaBaseUrl ? (
                <p id="mba-ollama-hint" className="mba__hint">
                  連線：{ollamaBaseUrl}
                  <br />
                  附圖分析請選<strong>視覺模型</strong>。
                </p>
              ) : null}
            </div>

            <div className="mba__field">
              <span className="mba__label">已送出的參考圖</span>
              {sentImageHistory.length === 0 ? (
                <p className="mba__hint">尚無。</p>
              ) : (
                <ul className="mba__img-hist" aria-label="此工作階段已送出的參考圖">
                  {sentImageHistory.map((it) => (
                    <li key={it.id}>
                      <img className="mba__img-hist-thumb" src={it.dataUrl} alt="" />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mba__field">
              <span className="mba__label">待送出參考圖</span>
              {imageErr ? <p className="mba__err">{imageErr}</p> : null}
              <div
                className="mba__drop mba__drop--compact"
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
                  <img className="mba__drop-preview" src={pendingImage.dataUrl} alt="待送出參考圖預覽" />
                ) : (
                  <span className="mba__drop-placeholder">點此或拖放圖片</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="mba__file-input"
                aria-label="選擇參考圖"
                onChange={(e) => ingestImageFile(e.target.files?.[0] ?? null)}
              />
              {pendingImage ? (
                <button type="button" className="mba__ghost" onClick={clearPendingImage}>
                  移除待送圖
                </button>
              ) : null}
            </div>

            <label className="mba__label" htmlFor="mba-input">
              需求描述
            </label>
            <textarea
              id="mba-input"
              className="mba__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="描述主題、風格、用途…（可留空若只送圖）"
              disabled={sending}
            />
            <div className="mba__actions">
              <button type="button" className="mba__send" disabled={!canSend} onClick={() => void send()}>
                {sending ? '處理中…' : '送出'}
              </button>
              <button type="button" className="mba__ghost" disabled={sending || ollamaLoading} onClick={() => void loadOllama()}>
                重新載入 Ollama 清單
              </button>
            </div>
            {chatError ? <p className="mba__err mba__err--block">{chatError}</p> : null}
          </div>
        </div>

        <div className="mba__col mba__col--right">
          <h3 className="mba__section-title mba__section-title--tight">此輪套組（快取）</h3>
          {!selectedEntry ? (
            <p className="mba__hint">送出後，此處會顯示最新一輪的套組與 Civitai 結果。</p>
          ) : (
            <>
              <p className="mba__bubble-reply" style={{ marginBottom: '12px' }}>
                {selectedEntry.replyZh}
              </p>
              <p className="mba__hist-meta">
                <time dateTime={selectedEntry.at}>{formatSearchTime(selectedEntry.at)}</time>
              </p>
              {selectedEntry.bundles.map((bundle, bi) => (
                <article key={`${selectedEntry.id}-bundle-${String(bi)}`} className="mba__bundle-block">
                  <h4 className="mba__bundle-head">{bundle.titleZh}</h4>
                  {bundle.noteZh ? <p className="mba__bundle-note">{bundle.noteZh}</p> : null}
                  {renderSlotSection('Checkpoint', bundle.checkpoint, `${selectedEntry.id}-ck-${String(bi)}`)}
                  {bundle.loras.map((lor, li) =>
                    renderSlotSection(`LoRA ${String(li + 1)}`, lor, `${selectedEntry.id}-lora-${String(bi)}-${String(li)}`),
                  )}
                </article>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
