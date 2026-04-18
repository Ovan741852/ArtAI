import { HttpPacket, HttpRequest } from '../http/types'

/** 與 `HttpClient` 相同邏輯：組出瀏覽器可用的 API 路徑（供 `<img src>`）。 */
export function resolveArtaiApiPath(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : '')
  const b = String(base).replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  if (!b) return p
  return `${b}${p}`
}

export type CharacterListRow = {
  id: string
  displayName: string | null
  imageCount: number
  updatedAt: string
  summaryZh: string | null
}

export type CharactersListOkData = {
  count: number
  characters: CharacterListRow[]
  storePath: string
  filesDir: string
}

export class CharactersListReq extends HttpRequest {
  get url(): string {
    return '/characters'
  }

  get method(): 'GET' {
    return 'GET'
  }

  get headers(): Record<string, string> {
    return {}
  }

  get responseType(): 'json' {
    return 'json'
  }
}

export class CharactersListRsp extends HttpPacket {
  ok = false
  message = ''
  data: CharactersListOkData | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    if (payload == null || typeof payload !== 'object') return
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.message = typeof o.message === 'string' ? o.message : '列表載入失敗'
      return
    }
    const rows: CharacterListRow[] = []
    const raw = o.characters
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (row == null || typeof row !== 'object') continue
        const r = row as Record<string, unknown>
        if (typeof r.id !== 'string') continue
        rows.push({
          id: r.id,
          displayName: typeof r.displayName === 'string' || r.displayName === null ? (r.displayName as string | null) : null,
          imageCount: typeof r.imageCount === 'number' ? r.imageCount : 0,
          updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
          summaryZh: typeof r.summaryZh === 'string' || r.summaryZh === null ? (r.summaryZh as string | null) : null,
        })
      }
    }
    this.ok = true
    this.data = {
      count: typeof o.count === 'number' ? o.count : rows.length,
      characters: rows,
      storePath: typeof o.storePath === 'string' ? o.storePath : '',
      filesDir: typeof o.filesDir === 'string' ? o.filesDir : '',
    }
  }
}

export type CharacterDetailImage = {
  id: string
  addedAt: string
  mime: string
  filePath: string
  isAnchor: boolean
}

export type CharacterDetailData = {
  human: {
    id: string
    displayName: string
    summaryZh: string | null
    imageCount: number
    createdAt: string
    updatedAt: string
  }
  machine: {
    characterId: string
    profileEn: Record<string, unknown> | null
    profileMergedAt: string | null
    images: CharacterDetailImage[]
  }
}

export class CharacterDetailReq extends HttpRequest {
  private characterId = ''

  onAllocate(characterId: string): void {
    this.characterId = characterId.trim()
  }

  get url(): string {
    return `/characters/${encodeURIComponent(this.characterId)}`
  }

  get method(): 'GET' {
    return 'GET'
  }

  get headers(): Record<string, string> {
    return {}
  }

  get responseType(): 'json' {
    return 'json'
  }
}

export class CharacterDetailRsp extends HttpPacket {
  ok = false
  message = ''
  data: CharacterDetailData | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    if (payload == null || typeof payload !== 'object') return
    const o = payload as Record<string, unknown>
    if (o.ok !== true) {
      this.message = typeof o.message === 'string' ? o.message : '載入失敗'
      return
    }
    const ch = o.character
    if (ch == null || typeof ch !== 'object') return
    const c = ch as Record<string, unknown>
    const humanRaw = c.human
    const machineRaw = c.machine
    if (humanRaw == null || typeof humanRaw !== 'object' || machineRaw == null || typeof machineRaw !== 'object') return
    const h = humanRaw as Record<string, unknown>
    const m = machineRaw as Record<string, unknown>
    const images: CharacterDetailImage[] = []
    const imgs = m.images
    if (Array.isArray(imgs)) {
      for (const row of imgs) {
        if (row == null || typeof row !== 'object') continue
        const r = row as Record<string, unknown>
        if (typeof r.id !== 'string' || typeof r.filePath !== 'string') continue
        images.push({
          id: r.id,
          addedAt: typeof r.addedAt === 'string' ? r.addedAt : '',
          mime: typeof r.mime === 'string' ? r.mime : '',
          filePath: r.filePath,
          isAnchor: r.isAnchor === true,
        })
      }
    }
    const profileEn = m.profileEn
    let profileObj: Record<string, unknown> | null = null
    if (profileEn != null && typeof profileEn === 'object' && !Array.isArray(profileEn)) {
      profileObj = profileEn as Record<string, unknown>
    }
    this.ok = true
    this.data = {
      human: {
        id: typeof h.id === 'string' ? h.id : '',
        displayName: typeof h.displayName === 'string' ? h.displayName : '',
        summaryZh: typeof h.summaryZh === 'string' || h.summaryZh === null ? (h.summaryZh as string | null) : null,
        imageCount: typeof h.imageCount === 'number' ? h.imageCount : 0,
        createdAt: typeof h.createdAt === 'string' ? h.createdAt : '',
        updatedAt: typeof h.updatedAt === 'string' ? h.updatedAt : '',
      },
      machine: {
        characterId: typeof m.characterId === 'string' ? m.characterId : '',
        profileEn: profileObj,
        profileMergedAt: typeof m.profileMergedAt === 'string' || m.profileMergedAt === null ? (m.profileMergedAt as string | null) : null,
        images,
      },
    }
  }
}

export class CharacterCreateReq extends HttpRequest {
  private displayName: string | null = null
  private imageBase64 = ''
  private ollamaModel: string | undefined

  onAllocate(params: { displayName: string | null; imageBase64: string; ollamaModel?: string }): void {
    this.displayName = params.displayName
    this.imageBase64 = params.imageBase64
    this.ollamaModel = params.ollamaModel?.trim() || undefined
  }

  get url(): string {
    return '/characters'
  }

  get method(): 'POST' {
    return 'POST'
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  get responseType(): 'json' {
    return 'json'
  }

  get body(): string {
    const o: Record<string, unknown> = { imageBase64: this.imageBase64 }
    if (this.displayName != null) o.displayName = this.displayName
    if (this.ollamaModel) o.ollamaModel = this.ollamaModel
    return JSON.stringify(o)
  }
}

export class CharacterMutationRsp extends HttpPacket {
  ok = false
  message = ''
  data: CharacterDetailData | null = null
  /** 422 等錯誤時伺服器附帶之 gate 資訊 */
  gate: string | null = null

  decode(payload: unknown): void {
    this.ok = false
    this.message = ''
    this.data = null
    this.gate = null
    if (payload == null || typeof payload !== 'object') return
    const o = payload as Record<string, unknown>
    if (typeof o.gate === 'string') this.gate = o.gate
    if (o.ok === true) {
      const inner = new CharacterDetailRsp()
      inner.decode({ ok: true, character: o.character })
      if (inner.ok && inner.data) {
        this.ok = true
        this.data = inner.data
      }
      return
    }
    this.message = typeof o.message === 'string' ? o.message : '操作失敗'
  }
}

export class CharacterAddImageReq extends HttpRequest {
  private characterId = ''
  private imageBase64 = ''
  private ollamaModel: string | undefined

  onAllocate(characterId: string, imageBase64: string, ollamaModel?: string): void {
    this.characterId = characterId.trim()
    this.imageBase64 = imageBase64
    this.ollamaModel = ollamaModel?.trim() || undefined
  }

  get url(): string {
    return `/characters/${encodeURIComponent(this.characterId)}/images`
  }

  get method(): 'POST' {
    return 'POST'
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  get responseType(): 'json' {
    return 'json'
  }

  get body(): string {
    const o: Record<string, unknown> = { imageBase64: this.imageBase64 }
    if (this.ollamaModel) o.ollamaModel = this.ollamaModel
    return JSON.stringify(o)
  }
}

export class CharacterProfileRefreshReq extends HttpRequest {
  private characterId = ''
  private ollamaModel: string | undefined

  onAllocate(characterId: string, ollamaModel?: string): void {
    this.characterId = characterId.trim()
    this.ollamaModel = ollamaModel?.trim() || undefined
  }

  get url(): string {
    return `/characters/${encodeURIComponent(this.characterId)}/profile/refresh`
  }

  get method(): 'POST' {
    return 'POST'
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  get responseType(): 'json' {
    return 'json'
  }

  get body(): string {
    const o: Record<string, unknown> = {}
    if (this.ollamaModel) o.ollamaModel = this.ollamaModel
    return JSON.stringify(o)
  }
}
