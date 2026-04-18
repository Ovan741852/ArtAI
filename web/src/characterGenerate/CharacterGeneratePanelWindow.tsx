import { useCallback, useEffect, useState } from 'react'
import {
  CharacterTxt2ImgReq,
  CharacterTxt2ImgRsp,
  CharactersListReq,
  CharactersListRsp,
  ComfyCheckpointsReq,
  ComfyCheckpointsRsp,
  OllamaModelsReq,
  OllamaModelsRsp,
  createDefaultHttpClient,
} from '../net'

import './characterGeneratePanel.css'

const client = createDefaultHttpClient()

export function CharacterGeneratePanelWindow() {
  const [characters, setCharacters] = useState<{ id: string; label: string }[]>([])
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [characterId, setCharacterId] = useState('')
  const [checkpoint, setCheckpoint] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [steps, setSteps] = useState('24')
  const [cfg, setCfg] = useState('7.5')
  const [width, setWidth] = useState('512')
  const [height, setHeight] = useState('512')
  const [seed, setSeed] = useState('')
  const [useAnchorIdentityLock, setUseAnchorIdentityLock] = useState(true)
  const [denoise, setDenoise] = useState('0.58')
  const [autoCheckpointByAi, setAutoCheckpointByAi] = useState(true)
  const [feedbackZh, setFeedbackZh] = useState('')
  const [useOllamaExpansion, setUseOllamaExpansion] = useState(true)
  const [ollamaNames, setOllamaNames] = useState<string[]>([])
  const [ollamaPicked, setOllamaPicked] = useState('')
  const [ollamaErr, setOllamaErr] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [infoZh, setInfoZh] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [positiveEn, setPositiveEn] = useState<string | null>(null)
  const [checkpointDecisionZh, setCheckpointDecisionZh] = useState<string | null>(null)
  const [feedbackApplied, setFeedbackApplied] = useState(false)
  const [lastCheckpointUsed, setLastCheckpointUsed] = useState<string | null>(null)

  const loadCharacters = useCallback(async () => {
    const res = await client.send(CharactersListReq.allocate(), CharactersListRsp)
    if (!res.ok || !res.data.ok || !res.data.data) return
    const opts = res.data.data.characters.map((c) => ({
      id: c.id,
      label: `${c.displayName?.trim() || '（未命名）'} · ${String(c.imageCount)} 張`,
    }))
    setCharacters(opts)
    setCharacterId((prev) => {
      if (opts.length === 0) return ''
      if (prev && opts.some((o) => o.id === prev)) return prev
      return opts[0].id
    })
  }, [])

  const loadCheckpoints = useCallback(async () => {
    const res = await client.send(ComfyCheckpointsReq.allocate(), ComfyCheckpointsRsp)
    if (!res.ok || !res.data.ok || !res.data.data) return
    const list = res.data.data.checkpoints
    setCheckpoints(list)
    setCheckpoint((prev) => {
      if (list.length === 0) return ''
      if (prev && list.includes(prev)) return prev
      return list[0]
    })
  }, [])

  useEffect(() => {
    void loadCharacters()
    void loadCheckpoints()
  }, [loadCharacters, loadCheckpoints])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await client.send(OllamaModelsReq.allocate(), OllamaModelsRsp)
      if (cancelled) return
      if (!res.ok) {
        setOllamaErr(res.error.message)
        return
      }
      if (!res.data.ok || !res.data.data) {
        setOllamaErr(res.data.message || '無法載入 Ollama')
        return
      }
      setOllamaErr(null)
      setOllamaNames(res.data.data.modelNames)
      if (res.data.data.modelNames.length > 0) {
        setOllamaPicked((prev) =>
          prev && res.data.data?.modelNames.includes(prev) ? prev : res.data.data!.modelNames[0],
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const revokeUrl = useCallback(() => {
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl)
      setResultUrl(null)
    }
  }, [resultUrl])

  useEffect(() => () => revokeUrl(), [revokeUrl])

  const onGenerate = useCallback(async () => {
    revokeUrl()
    setErr(null)
    setInfoZh(null)
    setPositiveEn(null)
    setCheckpointDecisionZh(null)
    setFeedbackApplied(false)
    const pid = characterId.trim()
    if (!pid) {
      setErr('請先選擇角色')
      return
    }
    const p = prompt.trim()
    if (!p) {
      setErr('請輸入想生成的內容（提示詞）')
      return
    }

    const payload: Record<string, unknown> = {
      prompt: p,
      useOllamaExpansion,
      identityMode: useAnchorIdentityLock ? 'anchor_img2img' : 'text_only',
      autoCheckpointByAi,
    }
    if (!autoCheckpointByAi && checkpoint.trim()) payload.checkpoint = checkpoint.trim()
    if (feedbackZh.trim()) payload.feedbackZh = feedbackZh.trim()
    if (lastCheckpointUsed) payload.previousCheckpointUsed = lastCheckpointUsed
    if (negative.trim()) payload.negative = negative.trim()
    const sn = Number(steps)
    if (Number.isFinite(sn) && sn > 0) payload.steps = Math.floor(sn)
    const cfgN = Number(cfg)
    if (Number.isFinite(cfgN)) payload.cfg = cfgN
    const wn = Number(width)
    const hn = Number(height)
    if (Number.isFinite(wn) && wn >= 64) payload.width = Math.floor(wn)
    if (Number.isFinite(hn) && hn >= 64) payload.height = Math.floor(hn)
    const sd = seed.trim()
    if (sd !== '') {
      const s = Number(sd)
      if (Number.isFinite(s)) payload.seed = Math.floor(s)
    }
    if (useAnchorIdentityLock) {
      const dn = Number(denoise)
      if (Number.isFinite(dn)) payload.denoise = dn
    }
    if (ollamaPicked.trim()) payload.ollamaModel = ollamaPicked.trim()

    setBusy(true)
    const req = CharacterTxt2ImgReq.allocate(pid, payload)
    const res = await client.send(req.encode(), CharacterTxt2ImgRsp)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || '生成失敗')
      return
    }
    const d = res.data.data
    setInfoZh(d.messageZh)
    setPositiveEn(d.positiveFinalEn)
    setCheckpointDecisionZh(d.checkpointDecisionZh || null)
    setFeedbackApplied(d.feedbackApplied)
    setLastCheckpointUsed(d.checkpointUsed || null)
    try {
      const bin = atob(d.imagePngBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'image/png' })
      setResultUrl(URL.createObjectURL(blob))
    } catch {
      setErr('無法解碼圖片')
    }
  }, [
    characterId,
    checkpoint,
    cfg,
    denoise,
    autoCheckpointByAi,
    feedbackZh,
    height,
    lastCheckpointUsed,
    negative,
    ollamaPicked,
    prompt,
    revokeUrl,
    seed,
    steps,
    useAnchorIdentityLock,
    useOllamaExpansion,
    width,
  ])

  return (
    <section className="chgen" aria-label="角色文生圖試作">
      <header className="chgen__head">
        <h2 className="chgen__title">角色文生圖試作</h2>
        <p className="chgen__lead">
          選擇角色庫裡的一位角色，用一句話描述想生成的畫面。伺服器會把角色的<strong>摘要／profile</strong>與你的描述交給
          Ollama 轉成英文提示詞（可關閉），並可由 AI 幫忙從本機清單挑 checkpoint。你也可以填「回饋」，讓 AI 在下一張自動調整。
          預設會用角色<strong>第一張錨點圖</strong>走 img2img 鎖定外觀，再送本機
          <strong> ComfyUI </strong>出圖；可關閉回到純文字模式。請確認 Comfy 已開、且有可用 checkpoint。
        </p>
      </header>

      {err ? (
        <p className="chgen__err" role="alert">
          {err}
        </p>
      ) : null}
      {infoZh ? <p className="chgen__ok">{infoZh}</p> : null}
      {checkpointDecisionZh ? <p className="chgen__ok">Checkpoint 決策：{checkpointDecisionZh}</p> : null}
      {feedbackApplied ? <p className="chgen__ok">已套用你的回饋進行本次調整。</p> : null}

      <div className="chgen__grid chgen__grid--2">
        <label className="chgen__label">
          角色
          <select className="chgen__select" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
            {characters.length === 0 ? <option value="">（尚無角色）</option> : null}
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="chgen__label">
          Checkpoint（Comfy）
          <select
            className="chgen__select"
            value={checkpoint}
            onChange={(e) => setCheckpoint(e.target.value)}
            disabled={autoCheckpointByAi}
          >
            {checkpoints.length === 0 ? (
              <option value="">（無法取得清單，請確認 Comfy）</option>
            ) : null}
            {checkpoints.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="chgen__label">
        提示詞（想生成什麼）
        <textarea
          className="chgen__textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例：在陽光下的公園裡微笑、側臉特寫"
        />
      </label>

      <label className="chgen__label">
        回饋（選填，讓 AI 決定下一張怎麼調整）
        <textarea
          className="chgen__textarea"
          value={feedbackZh}
          onChange={(e) => setFeedbackZh(e.target.value)}
          placeholder="例：上一張臉太不像、鼻子太尖、背景太亂，希望更簡潔。"
        />
      </label>

      <label className="chgen__label">
        負向提示（選填）
        <input
          className="chgen__input"
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          placeholder="留空則使用伺服器預設"
        />
      </label>

      <div className="chgen__grid chgen__grid--2">
        <label className="chgen__label">
          steps
          <input className="chgen__input" value={steps} onChange={(e) => setSteps(e.target.value)} inputMode="numeric" />
        </label>
        <label className="chgen__label">
          cfg
          <input className="chgen__input" value={cfg} onChange={(e) => setCfg(e.target.value)} inputMode="decimal" />
        </label>
        <label className="chgen__label">
          寬
          <input className="chgen__input" value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" />
        </label>
        <label className="chgen__label">
          高
          <input className="chgen__input" value={height} onChange={(e) => setHeight(e.target.value)} inputMode="numeric" />
        </label>
      </div>

      <label className="chgen__label">
        seed（選填，空白則隨機）
        <input className="chgen__input" value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
      </label>

      <div className="chgen__row">
        <label className="chgen__check">
          <input type="checkbox" checked={autoCheckpointByAi} onChange={(e) => setAutoCheckpointByAi(e.target.checked)} />
          讓 AI 從本機 checkpoint 清單中幫忙挑選
        </label>
      </div>

      <div className="chgen__row">
        <label className="chgen__check">
          <input type="checkbox" checked={useAnchorIdentityLock} onChange={(e) => setUseAnchorIdentityLock(e.target.checked)} />
          使用角色第一張錨點圖做外觀鎖定（img2img 試作）
        </label>
        {useAnchorIdentityLock ? (
          <label className="chgen__label" style={{ minWidth: 220 }}>
            denoise（0~1，越低越像錨點）
            <input className="chgen__input" value={denoise} onChange={(e) => setDenoise(e.target.value)} inputMode="decimal" />
          </label>
        ) : null}
      </div>

      <div className="chgen__row">
        <label className="chgen__check">
          <input type="checkbox" checked={useOllamaExpansion} onChange={(e) => setUseOllamaExpansion(e.target.checked)} />
          用 Ollama 把角色資料與提示詞整理成英文再出圖
        </label>
      </div>

      <div className="chgen__row">
        <label className="chgen__label" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Ollama 模型</span>
          <select
            className="chgen__select"
            style={{ minWidth: 200 }}
            value={ollamaPicked}
            onChange={(e) => setOllamaPicked(e.target.value)}
            disabled={ollamaNames.length === 0}
          >
            {ollamaNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {ollamaErr ? <span className="chgen__lead">{ollamaErr}</span> : null}
      </div>

      <div className="chgen__row">
        <button type="button" className="chgen__btn" disabled={busy} onClick={() => void onGenerate()}>
          {busy ? '生成中（可能需數十秒）…' : '生成圖片'}
        </button>
        <button type="button" className="chgen__btn" style={{ background: 'var(--bg)', color: 'var(--text-h)' }} onClick={() => void loadCharacters()}>
          重新載入角色
        </button>
      </div>

      {resultUrl ? (
        <div className="chgen__result">
          <img src={resultUrl} alt="生成結果" />
        </div>
      ) : null}
      {positiveEn ? <pre className="chgen__mono">實際正向提示（英文）：{'\n'}{positiveEn}</pre> : null}
    </section>
  )
}
