import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import {
  MattingAutoReq,
  MattingAutoRsp,
  OllamaModelsReq,
  OllamaModelsRsp,
  createDefaultHttpClient,
  type MattingAutoOkData,
  type MattingEnhancementsRequest,
} from '../net'

import './mattingPanel.css'

const client = createDefaultHttpClient()

const MAX_FILE_BYTES = 8 * 1024 * 1024

type PendingImage = {
  dataUrl: string
  /** raw base64 without data URL prefix */
  base64: string
}

function subjectLabelZh(s: string): string {
  switch (s) {
    case 'single_human_portrait':
      return '單人人像'
    case 'multiple_humans':
      return '多人'
    case 'product_object':
      return '商品／物件'
    case 'scene_mixed':
      return '場景／混合'
    default:
      return s || '—'
  }
}

function edgeLabelZh(s: string): string {
  switch (s) {
    case 'simple':
      return '簡單'
    case 'moderate':
      return '中等'
    case 'hard':
      return '困難（細節邊緣）'
    default:
      return s || '—'
  }
}

function executorLabelZh(e: MattingAutoOkData['chosenExecutor']): string {
  switch (e) {
    case 'comfy':
      return 'ComfyUI 節點'
    case 'local_onnx':
      return '本機 ONNX'
    default:
      return e
  }
}

export function MattingPanelWindow() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [imageErr, setImageErr] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImage | null>(null)
  const [result, setResult] = useState<MattingAutoOkData | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [ollamaLoading, setOllamaLoading] = useState(true)
  const [ollamaErr, setOllamaErr] = useState<string | null>(null)
  const [ollamaNames, setOllamaNames] = useState<string[]>([])
  const [ollamaPicked, setOllamaPicked] = useState('')

  const [enhanceEdge, setEnhanceEdge] = useState(false)

  const revokeResultUrl = useCallback(() => {
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  const ingestFile = useCallback((file: File | null) => {
    setImageErr(null)
    setErr(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setImageErr('請選擇圖片檔。')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setImageErr(`圖片請小於 ${String(Math.floor(MAX_FILE_BYTES / 1024 / 1024))} MB。`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const comma = dataUrl.indexOf(',')
      const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
      if (!b64) {
        setImageErr('無法讀取圖片。')
        return
      }
      setPending({ dataUrl, base64: b64 })
      setResult(null)
      revokeResultUrl()
    }
    reader.onerror = () => setImageErr('讀取圖片失敗。')
    reader.readAsDataURL(file)
  }, [revokeResultUrl])

  const loadOllama = useCallback(async () => {
    setOllamaLoading(true)
    setOllamaErr(null)
    const res = await client.sendRequest(OllamaModelsReq.allocate(), OllamaModelsRsp)
    setOllamaLoading(false)
    if (!res.ok) {
      setOllamaNames([])
      setOllamaErr(res.error.message)
      return
    }
    const p = res.data
    if (!p.ok || !p.data) {
      setOllamaNames([])
      setOllamaErr(p.message || '無法取得 Ollama 模型')
      return
    }
    setOllamaNames(p.data.modelNames.length > 0 ? p.data.modelNames : p.data.models.map((m) => m.name))
    setOllamaErr(null)
  }, [])

  useEffect(() => {
    void loadOllama()
  }, [loadOllama])

  useEffect(() => {
    const names = ollamaNames
    if (names.length === 0) return
    setOllamaPicked((prev) => (prev && names.includes(prev) ? prev : names[0]))
  }, [ollamaNames])

  useEffect(() => {
    return () => {
      revokeResultUrl()
    }
  }, [revokeResultUrl])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files?.[0] ?? null
      ingestFile(f)
    },
    [ingestFile],
  )

  const runMatting = useCallback(async () => {
    if (!pending) {
      setErr('請先放一張圖。')
      return
    }
    setLoading(true)
    setErr(null)
    revokeResultUrl()
    setResult(null)

    const enhancements: MattingEnhancementsRequest | undefined = enhanceEdge ? { edgeRefine: true } : undefined

    const res = await client.sendRequest(
      MattingAutoReq.allocate(pending.base64, ollamaPicked || undefined, enhancements),
      MattingAutoRsp,
    )
    setLoading(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    const p = res.data
    if (!p.ok || !p.data) {
      setErr(p.message || '摳圖失敗')
      return
    }
    const bytes = Uint8Array.from(atob(p.data.imagePngBase64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    setResultUrl(url)
    setResult(p.data)
  }, [pending, ollamaPicked, enhanceEdge, revokeResultUrl])

  const downloadPng = useCallback(() => {
    if (!resultUrl) return
    const a = document.createElement('a')
    a.href = resultUrl
    a.download = 'artai-matting.png'
    a.rel = 'noopener'
    a.click()
  }, [resultUrl])

  return (
    <div className="mat">
      <header className="mat__head">
        <h2 className="mat__title">摳圖</h2>
        <p className="mat__lead">
          把圖拖進來或點選區域上傳，按「摳圖」後由伺服器讀圖、自動選擇後端（Comfy／Remove.bg／本機）並回傳透明背景 PNG。
        </p>
      </header>

      <div className="mat__row">
        <span className="mat__label">讀圖分類用 Ollama 模型（建議選支援視覺者）</span>
        <select
          className="mat__select"
          value={ollamaPicked}
          onChange={(e) => setOllamaPicked(e.target.value)}
          disabled={ollamaLoading || ollamaNames.length === 0}
          aria-label="Ollama 模型"
        >
          {ollamaNames.length === 0 ? (
            <option value="">{ollamaLoading ? '載入中…' : '無可用模型'}</option>
          ) : (
            ollamaNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))
          )}
        </select>
        <button type="button" className="mat__btn mat__btn--ghost" onClick={() => void loadOllama()} disabled={ollamaLoading}>
          重新載入模型
        </button>
      </div>
      {ollamaErr ? <p className="mat__err">{ollamaErr}</p> : null}

      <div className="mat__toggles" aria-label="摳圖強化選項">
        <p className="mat__toggles-title">強化（第二輪）</p>
        <p className="mat__toggles-hint">勾選後，第一輪成功會用原圖在邊界帶與結果混合（修邊／半透明邊），不再跑第二輪 WASM 去背。</p>
        <div className="mat__toggle-row">
          <input
            id="mat-enhance-edge"
            type="checkbox"
            checked={enhanceEdge}
            onChange={(e) => setEnhanceEdge(e.target.checked)}
            disabled={loading}
          />
          <label className="mat__toggle-label" htmlFor="mat-enhance-edge">
            邊緣強化
            <span className="mat__toggle-note">第一輪後以原圖對齊、在半透明邊界帶混合 RGB（保留 alpha）。</span>
          </label>
        </div>
      </div>

      <div className="mat__grid">
        <div className="mat__card">
          <h3 className="mat__card-title">原圖</h3>
          <input ref={fileRef} className="mat__file" type="file" accept="image/*" onChange={(e) => ingestFile(e.target.files?.[0] ?? null)} />
          <div
            className={`mat__drop${dragOver ? ' mat__drop--active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileRef.current?.click()
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              if (e.currentTarget === e.target) setDragOver(false)
            }}
            onDrop={onDrop}
          >
            {pending ? (
              <img className="mat__preview" src={pending.dataUrl} alt="待摳圖預覽" />
            ) : (
              <div className="mat__drop-inner">
                <strong>點此或拖曳圖片</strong>
                <br />
                PNG／JPEG／WebP，最大 8 MB
              </div>
            )}
          </div>
          {imageErr ? <p className="mat__err">{imageErr}</p> : null}
          <div className="mat__actions">
            <button type="button" className="mat__btn" onClick={() => void runMatting()} disabled={loading || !pending}>
              {loading ? '處理中…' : '摳圖'}
            </button>
            {pending ? (
              <button
                type="button"
                className="mat__btn mat__btn--ghost"
                onClick={() => {
                  setPending(null)
                  setImageErr(null)
                  setResult(null)
                  revokeResultUrl()
                  setErr(null)
                  if (fileRef.current) fileRef.current.value = ''
                }}
                disabled={loading}
              >
                清除圖片
              </button>
            ) : null}
          </div>
        </div>

        <div className="mat__card">
          <h3 className="mat__card-title">結果</h3>
          {resultUrl ? (
            <div className="mat__checker">
              <img className="mat__result-img" src={resultUrl} alt="摳圖結果" />
            </div>
          ) : (
            <p className="mat__meta">尚未產生結果。</p>
          )}
          {err ? <p className="mat__err">{err}</p> : null}
          {result ? (
            <dl className="mat__meta">
              <dt>實際使用</dt>
              <dd>
                {executorLabelZh(result.chosenExecutor)}
                {result.comfyNodeType ? `（${result.comfyNodeType}）` : ''}
              </dd>
              <dt>為何這樣選</dt>
              <dd>{result.chosenReasonZh}</dd>
              <dt>讀圖分類</dt>
              <dd>
                主體：{subjectLabelZh(result.classification.primarySubject)}；邊緣：{edgeLabelZh(result.classification.edgeDifficulty)}
                ；{result.classification.preferQualityOverSpeed ? '偏成品質' : '可接受較快'}
              </dd>
              <dt>嘗試順序</dt>
              <dd>{result.triedExecutors.join(' → ')}</dd>
              <dt>Ollama</dt>
              <dd>
                {result.ollamaModelUsed}
                {result.visionClassificationUsed ? '（已用視覺讀圖）' : '（未用視覺或失敗）'}
              </dd>
              <dt>強化第二輪</dt>
              <dd>
                {result.enhancementSecondPassUsed
                  ? result.enhancementAppliedStepsZh.length > 0
                    ? result.enhancementAppliedStepsZh.join(' → ')
                    : '已請求但無適用步驟'
                  : '未使用'}
                {result.enhancementsRequested.edgeRefine ? <> （已勾邊緣強化）</> : null}
              </dd>
            </dl>
          ) : null}
          {result && result.warnings.length > 0 ? (
            <ul className="mat__warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {resultUrl ? (
            <div className="mat__actions">
              <button type="button" className="mat__btn mat__btn--ghost" onClick={downloadPng}>
                下載 PNG
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
