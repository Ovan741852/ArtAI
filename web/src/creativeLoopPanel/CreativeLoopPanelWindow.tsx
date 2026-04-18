import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { CheckpointNameTags } from '../components/checkpoint/CheckpointNameTags'
import {
  CreativeLoopChatReq,
  CreativeLoopChatRsp,
  CreativeLoopResourceCheckReq,
  CreativeLoopResourceCheckRsp,
  OllamaModelsReq,
  OllamaModelsRsp,
  WorkflowTemplateRunReq,
  WorkflowTemplateRunRsp,
  createDefaultHttpClient,
  type CreativeLoopChatMessage,
  type CreativeLoopResourceChecklistItem,
} from '../net'

import './creativeLoopPanel.css'

const client = createDefaultHttpClient()

const MAX_REF = 6
const MAX_FILE_BYTES = 8 * 1024 * 1024

const FEEDBACK_TAGS: { id: string; label: string }[] = [
  { id: 'composition', label: '構圖' },
  { id: 'light', label: '光線' },
  { id: 'style', label: '風格' },
  { id: 'not_like_ref', label: '不像參考圖' },
  { id: 'darker', label: '希望更暗' },
  { id: 'brighter', label: '希望更亮' },
  { id: 'more_real', label: '更寫實' },
  { id: 'less_real', label: '不要那麼寫實' },
  { id: 'closer_ref', label: '更貼參考圖' },
  { id: 'other', label: '其他' },
]

type RefImg = {
  id: string
  dataUrl: string
  base64: string
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function kindLabelZh(kind: CreativeLoopResourceChecklistItem['kind']): string {
  switch (kind) {
    case 'checkpoint':
      return 'Checkpoint'
    case 'lora':
      return 'LoRA'
    case 'vae':
      return 'VAE'
    default:
      return '其他'
  }
}

export function CreativeLoopPanelWindow() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [ollamaLoading, setOllamaLoading] = useState(true)
  const [ollamaErr, setOllamaErr] = useState<string | null>(null)
  const [ollamaNames, setOllamaNames] = useState<string[]>([])
  const [ollamaPicked, setOllamaPicked] = useState('')

  const [requirement, setRequirement] = useState('')
  const [refs, setRefs] = useState<RefImg[]>([])
  const [dragOver, setDragOver] = useState(false)

  const [messages, setMessages] = useState<CreativeLoopChatMessage[]>([])
  const [lastProposedPatch, setLastProposedPatch] = useState<Record<string, unknown> | null>(null)
  const [lastReplyZh, setLastReplyZh] = useState<string | null>(null)
  const [planWarnings, setPlanWarnings] = useState<string[]>([])
  const [templateRouteZh, setTemplateRouteZh] = useState<string | null>(null)

  const [plannedTemplateId, setPlannedTemplateId] = useState<string | null>(null)

  const [resourceCheckReady, setResourceCheckReady] = useState(false)
  const [resourceReplyZh, setResourceReplyZh] = useState<string | null>(null)
  const [resourceNoteZh, setResourceNoteZh] = useState<string | null>(null)
  const [checklist, setChecklist] = useState<CreativeLoopResourceChecklistItem[]>([])
  const [checklistChecked, setChecklistChecked] = useState<Record<string, boolean>>({})

  const [awaitRating, setAwaitRating] = useState(false)
  const [lastOutputBase64, setLastOutputBase64] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  const [attachLastToNextAi, setAttachLastToNextAi] = useState(false)

  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [feedbackText, setFeedbackText] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const allChecklistChecked = useMemo(() => {
    if (checklist.length === 0) return false
    return checklist.every((it) => checklistChecked[it.id] === true)
  }, [checklist, checklistChecked])

  const revokeResultUrl = useCallback(() => {
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  const loadOllama = useCallback(async () => {
    setOllamaLoading(true)
    setOllamaErr(null)
    const res = await client.sendRequest(OllamaModelsReq.allocate(), OllamaModelsRsp)
    setOllamaLoading(false)
    if (!res.ok) {
      setOllamaErr(res.error.message)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setOllamaErr(res.data.message || '無法載入 Ollama 模型')
      return
    }
    const names = res.data.data.modelNames
    setOllamaNames(names)
    setOllamaPicked((prev) => (prev && names.includes(prev) ? prev : names[0] ?? ''))
  }, [])

  useEffect(() => {
    void loadOllama()
  }, [loadOllama])

  const ingestFiles = useCallback((files: FileList | File[]) => {
    setErr(null)
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (arr.length === 0) {
      setErr('請選擇圖片檔。')
      return
    }
    for (const file of arr) {
      if (file.size > MAX_FILE_BYTES) {
        setErr(`每張圖請小於 ${String(Math.floor(MAX_FILE_BYTES / 1024 / 1024))} MB。`)
        return
      }
    }

    const readOne = (file: File) =>
      new Promise<RefImg | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : ''
          const comma = dataUrl.indexOf(',')
          const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
          if (!b64) {
            resolve(null)
            return
          }
          resolve({ id: randomId(), dataUrl, base64: b64 })
        }
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })

    void (async () => {
      for (const file of arr) {
        const img = await readOne(file)
        if (!img) continue
        setRefs((prev) => {
          if (prev.length >= MAX_REF) return prev
          return [...prev, img]
        })
      }
    })()
  }, [])

  const removeRef = useCallback((id: string) => {
    setRefs((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files?.length) ingestFiles(e.dataTransfer.files)
    },
    [ingestFiles],
  )

  const clearSession = useCallback(() => {
    setMessages([])
    setLastProposedPatch(null)
    setLastReplyZh(null)
    setPlanWarnings([])
    setTemplateRouteZh(null)
    setPlannedTemplateId(null)
    setResourceCheckReady(false)
    setResourceReplyZh(null)
    setResourceNoteZh(null)
    setChecklist([])
    setChecklistChecked({})
    setAwaitRating(false)
    setLastOutputBase64(null)
    setRequirement('')
    setRefs([])
    setSelectedTags(new Set())
    setFeedbackText('')
    setErr(null)
    revokeResultUrl()
  }, [revokeResultUrl])

  const askAi = useCallback(async () => {
    const text = requirement.trim()
    if (!text) {
      setErr('請先填寫文字需求（必填）。')
      return
    }
    if (awaitRating) {
      setErr('請先完成上一張圖的評價，再繼續，以免浪費調整方向。')
      return
    }
    setBusy(true)
    setErr(null)
    const nextMessages: CreativeLoopChatMessage[] = [...messages, { role: 'user', content: text }]
    const res = await client.sendRequest(
      CreativeLoopChatReq.allocate(nextMessages, {
        ollamaModel: ollamaPicked || undefined,
        imageBase64s: refs.map((r) => r.base64),
        lastOutputPngBase64: attachLastToNextAi && lastOutputBase64 ? lastOutputBase64 : null,
      }),
      CreativeLoopChatRsp,
    )
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || 'AI 回應失敗')
      return
    }
    const d = res.data.data
    setMessages([...nextMessages, { role: 'assistant', content: d.assistant.replyZh }])
    setLastReplyZh(d.assistant.replyZh)
    setLastProposedPatch(d.assistant.proposedPatch)
    setPlannedTemplateId(d.selectedTemplateId || null)
    setTemplateRouteZh(d.templateRouteZh || null)
    setPlanWarnings(d.warnings ?? [])
    setRequirement('')
    setResourceCheckReady(false)
    setResourceReplyZh(null)
    setResourceNoteZh(null)
    setChecklist([])
    setChecklistChecked({})
  }, [
    requirement,
    awaitRating,
    messages,
    ollamaPicked,
    refs,
    attachLastToNextAi,
    lastOutputBase64,
  ])

  const runResourceCheck = useCallback(async () => {
    if (!plannedTemplateId || lastProposedPatch == null) {
      setErr('請先完成「先問 AI」取得建議。')
      return
    }
    if (awaitRating) {
      setErr('請先完成上一張圖的評價。')
      return
    }
    setBusy(true)
    setErr(null)
    const triggerContent =
      '請列出執行上述生圖建議所需的 Checkpoint、LoRA、VAE 等資源清單（繁中標題；checkpoint 盡量給精確 .safetensors 檔名；其他給英文 tags／搜尋字）。'
    const triggerMessages: CreativeLoopChatMessage[] = [...messages, { role: 'user', content: triggerContent }]
    const res = await client.sendRequest(
      CreativeLoopResourceCheckReq.allocate(triggerMessages, plannedTemplateId, lastProposedPatch, {
        ollamaModel: ollamaPicked || undefined,
      }),
      CreativeLoopResourceCheckRsp,
    )
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || '資源盤點失敗')
      return
    }
    const d = res.data.data
    setMessages([...triggerMessages, { role: 'assistant', content: d.replyZh }])
    setResourceReplyZh(d.replyZh)
    setResourceNoteZh(d.noteZh)
    setChecklist(d.checklist)
    const init: Record<string, boolean> = {}
    for (const it of d.checklist) {
      init[it.id] = it.hasLocal
    }
    setChecklistChecked(init)
    setResourceCheckReady(true)
  }, [plannedTemplateId, lastProposedPatch, awaitRating, messages, ollamaPicked])

  const runGenerate = useCallback(async () => {
    if (!plannedTemplateId) {
      setErr('請先「先問 AI」取得模板與建議。')
      return
    }
    if (!resourceCheckReady || !allChecklistChecked) {
      setErr('請先完成「盤點資源（問 AI）」，並勾選清單上每一項（表示已備妥或已確認）。')
      return
    }
    if (awaitRating) {
      setErr('請先完成上一張圖的評價。')
      return
    }
    setBusy(true)
    setErr(null)
    const refB64 = plannedTemplateId === 'basic-img2img' && refs[0]?.base64 ? refs[0].base64 : undefined
    const res = await client.sendRequest(
      WorkflowTemplateRunReq.allocate(plannedTemplateId, lastProposedPatch ?? {}, undefined, refB64 ?? null),
      WorkflowTemplateRunRsp,
    )
    setBusy(false)
    if (!res.ok) {
      setErr(`生圖失敗：${res.error.message}。可檢查 ComfyUI 是否開啟、checkpoint 檔名是否存在，或換個需求再試。`)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || '生圖失敗')
      return
    }
    const b64 = res.data.data.imagePngBase64
    setLastOutputBase64(b64)
    revokeResultUrl()
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'image/png' })
    setResultUrl(URL.createObjectURL(blob))
    setAwaitRating(true)
    setSelectedTags(new Set())
    setFeedbackText('')
  }, [plannedTemplateId, resourceCheckReady, allChecklistChecked, awaitRating, lastProposedPatch, refs, revokeResultUrl])

  const submitRating = useCallback(() => {
    if (!awaitRating) return
    const tags = FEEDBACK_TAGS.filter((t) => selectedTags.has(t.id)).map((t) => t.label)
    const extra = feedbackText.trim()
    const lines = ['【對上一張成品的回饋】']
    if (tags.length) lines.push(`勾選：${tags.join('、')}`)
    if (extra) lines.push(`補充：${extra}`)
    const content = lines.join('\n')
    setMessages((m) => [...m, { role: 'user', content }])
    setAwaitRating(false)
    setSelectedTags(new Set())
    setFeedbackText('')
  }, [awaitRating, selectedTags, feedbackText])

  const toggleTag = useCallback((id: string) => {
    setSelectedTags((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const toggleChecklist = useCallback((id: string) => {
    setChecklistChecked((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const generateDisabled =
    busy || awaitRating || !plannedTemplateId || !resourceCheckReady || !allChecklistChecked

  return (
    <div className="cloop cloop--layout">
      <div className="cloop__main">
        <h2 className="cloop__title">創意閉環（實驗）</h2>
        <p className="cloop__lead">
          填寫需求（必填）→ 可附參考圖（有圖時伺服器自動走圖生圖模板）→「先問 AI」→「盤點資源」在右欄確認
          Checkpoint／LoRA／VAE → 清單<strong>全部勾選</strong>後才能「依建議生圖」。生圖後請先評價再進下一輪。
        </p>

        <div className="cloop__toolbar">
          <button type="button" onClick={clearSession} disabled={busy}>
            中止並清空
          </button>
        </div>

        <div className="cloop__row">
          <div className="cloop__field">
            <label htmlFor="cloop-ollama">Ollama 模型</label>
            <select
              id="cloop-ollama"
              value={ollamaPicked}
              onChange={(e) => setOllamaPicked(e.target.value)}
              disabled={busy || ollamaLoading || ollamaNames.length === 0}
            >
              {ollamaNames.length === 0 ? <option value="">（無模型）</option> : null}
              {ollamaNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {ollamaErr ? <span className="cloop__err">{ollamaErr}</span> : null}
          </div>
        </div>

        {templateRouteZh ? (
          <p className="cloop__hint" role="status">
            本輪路線：<strong>{templateRouteZh}</strong>
            {plannedTemplateId ? `（${plannedTemplateId}）` : ''}
          </p>
        ) : null}
        {planWarnings.length > 0 ? (
          <ul className="cloop__hint">
            {planWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        <label className="cloop__label" htmlFor="cloop-req">
          文字需求（必填）
        </label>
        <textarea
          id="cloop-req"
          className="cloop__req"
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder="例：想要黃昏海邊、人物在畫面左側、整體偏暖色、電影感構圖……"
          disabled={busy || awaitRating}
        />
        <p className="cloop__hint">僅附圖而不寫需求無法送出，避免目標飄移。</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) ingestFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div
          className={`cloop__drop${dragOver ? ' cloop__drop--active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
        >
          拖放參考圖到這裡，或點擊多選檔案（最多 {String(MAX_REF)} 張，每張小於 8 MB）
        </div>

        {refs.length > 0 ? (
          <div className="cloop__thumbs">
            {refs.map((r) => (
              <div key={r.id} className="cloop__thumb">
                <img src={r.dataUrl} alt="" />
                <button type="button" className="cloop__thumb-remove" onClick={() => removeRef(r.id)} aria-label="移除">
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {lastOutputBase64 ? (
          <label className="cloop__tag" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={attachLastToNextAi}
              onChange={(e) => setAttachLastToNextAi(e.target.checked)}
              disabled={busy}
            />
            下一輪「先問 AI」時附上上一張成品給 AI 對照
          </label>
        ) : null}

        <div className="cloop__actions cloop__actions--primary">
          <button type="button" onClick={() => void askAi()} disabled={busy || awaitRating}>
            先問 AI
          </button>
          <button
            type="button"
            onClick={() => void runResourceCheck()}
            disabled={busy || awaitRating || !plannedTemplateId || lastProposedPatch == null}
          >
            盤點資源（問 AI）
          </button>
          <button type="button" onClick={() => void runGenerate()} disabled={generateDisabled}>
            依建議生圖
          </button>
        </div>

        {awaitRating ? (
          <div className="cloop__warn" role="status">
            已生成圖片：請先勾選標籤（可複選）並可填短句，按「送出評價」後才能再問 AI 或生圖。
          </div>
        ) : null}

        {err ? <div className="cloop__err">{err}</div> : null}

        {lastReplyZh ? (
          <div className="cloop__reply">
            <strong>AI 說明</strong>
            {'\n'}
            {lastReplyZh}
          </div>
        ) : null}

        {resultUrl ? (
          <div className="cloop__result">
            <p className="cloop__label">結果預覽</p>
            <img src={resultUrl} alt="生成結果" />
          </div>
        ) : null}

        {awaitRating ? (
          <div className="cloop__rating">
            <div className="cloop__label">哪裡想調整？（可複選）</div>
            <div className="cloop__tags">
              {FEEDBACK_TAGS.map((t) => (
                <label key={t.id} className="cloop__tag">
                  <input type="checkbox" checked={selectedTags.has(t.id)} onChange={() => toggleTag(t.id)} />
                  {t.label}
                </label>
              ))}
            </div>
            <label className="cloop__label" htmlFor="cloop-fb-text">
              補充一句話（選填）
            </label>
            <textarea
              id="cloop-fb-text"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="例：希望人物再大一点、背景再簡單……"
            />
            <button type="button" onClick={submitRating} disabled={selectedTags.size === 0 && !feedbackText.trim()}>
              送出評價
            </button>
            {selectedTags.size === 0 && !feedbackText.trim() ? (
              <p className="cloop__hint">請至少勾選一個標籤，或填寫補充說明。</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="cloop__aside" aria-label="資源 checklist">
        <h3 className="cloop__aside-title">資源 checklist</h3>
        <p className="cloop__aside-lead">
          完成「先問 AI」後按「盤點資源」。請逐項勾選表示已備妥；缺檔可點連結到 Civitai 搜尋。
        </p>
        {resourceReplyZh ? (
          <div className="cloop__reply cloop__reply--compact">
            <strong>資源說明</strong>
            {'\n'}
            {resourceReplyZh}
          </div>
        ) : null}
        {resourceNoteZh ? <p className="cloop__hint">{resourceNoteZh}</p> : null}

        {checklist.length === 0 ? (
          <p className="cloop__hint">尚無清單。請先「先問 AI」，再按「盤點資源」。</p>
        ) : (
          <ul className="cloop__checklist">
            {checklist.map((it) => (
              <li key={it.id} className="cloop__check-item">
                <div className="cloop__check-head">
                  <label className="cloop__check-label">
                    <input
                      type="checkbox"
                      checked={checklistChecked[it.id] === true}
                      onChange={() => toggleChecklist(it.id)}
                    />
                    <span className="cloop__check-kind">{kindLabelZh(it.kind)}</span>
                  </label>
                  <a className="cloop__check-link" href={it.browseUrl} target="_blank" rel="noopener noreferrer">
                    前往 Civitai 搜尋
                  </a>
                </div>
                {it.kind === 'checkpoint' ? (
                  <CheckpointNameTags
                    className="cloop__cknt"
                    name={it.filename || it.titleZh}
                    tags={it.modelTags}
                    caption={it.detailZh ?? it.titleZh}
                    localPresence={it.hasLocal ? 'match-installed' : 'match-missing'}
                    emptyHint={it.modelTags.length === 0 ? '（無建議 tags）' : undefined}
                  />
                ) : (
                  <div className="cloop__check-body">
                    <div className="cloop__check-title">{it.titleZh}</div>
                    {it.detailZh ? <p className="cloop__hint">{it.detailZh}</p> : null}
                    {it.modelTags.length > 0 ? (
                      <CheckpointNameTags
                        className="cloop__cknt"
                        name={it.titleZh}
                        tags={it.modelTags}
                        showTitle={false}
                        localPresence="hidden"
                      />
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {checklist.length > 0 ? (
          <p className="cloop__hint" role="status">
            {allChecklistChecked ? '已可按下「依建議生圖」。' : '請勾滿清單後再生成。'}
          </p>
        ) : null}
      </aside>
    </div>
  )
}
