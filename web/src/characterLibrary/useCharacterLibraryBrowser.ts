import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CharacterAddImageReq,
  CharacterCreateReq,
  CharacterDetailReq,
  CharacterDetailRsp,
  CharacterMutationRsp,
  CharacterProfileRefreshReq,
  CharactersListReq,
  CharactersListRsp,
  OllamaModelsReq,
  OllamaModelsRsp,
  createDefaultHttpClient,
  type CharacterDetailData,
  type CharacterListRow,
} from '../net'

const client = createDefaultHttpClient()

export const MAX_CHARACTER_IMAGE_BYTES = 8 * 1024 * 1024

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const r = fr.result
      if (typeof r === 'string') resolve(r)
      else reject(new Error('read failed'))
    }
    fr.onerror = () => reject(fr.error ?? new Error('read failed'))
    fr.readAsDataURL(file)
  })
}

export function useCharacterLibraryBrowser() {
  const createFileRef = useRef<HTMLInputElement>(null)
  const addFileRef = useRef<HTMLInputElement>(null)

  const [list, setList] = useState<CharacterListRow[]>([])
  const [storeHint, setStoreHint] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CharacterDetailData | null>(null)

  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [newDisplayName, setNewDisplayName] = useState('')
  const [ollamaPicked, setOllamaPicked] = useState('')
  const [ollamaNames, setOllamaNames] = useState<string[]>([])
  const [ollamaErr, setOllamaErr] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setErr(null)
    const res = await client.send(CharactersListReq.allocate(), CharactersListRsp)
    setLoadingList(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || '列表失敗')
      return
    }
    setList(res.data.data.characters)
    setStoreHint(`${res.data.data.storePath} · ${res.data.data.filesDir}`)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true)
    setErr(null)
    const req = CharacterDetailReq.allocate(id)
    const res = await client.send(req.encode(), CharacterDetailRsp)
    setLoadingDetail(false)
    if (!res.ok) {
      setErr(res.error.message)
      setDetail(null)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || '詳情載入失敗')
      setDetail(null)
      return
    }
    setDetail(res.data.data)
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

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
        setOllamaErr(res.data.message || '無法載入 Ollama 模型')
        return
      }
      setOllamaErr(null)
      setOllamaNames(res.data.data.modelNames)
      if (res.data.data.modelNames.length > 0) {
        setOllamaPicked((prev) => (prev && res.data.data?.modelNames.includes(prev) ? prev : res.data.data!.modelNames[0]))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const ollamaModelOpt = ollamaPicked.trim() || undefined

  const onCreateFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (file.size > MAX_CHARACTER_IMAGE_BYTES) {
        setErr('檔案過大（上限 8 MB）')
        return
      }
      setBusy(true)
      setErr(null)
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const req = CharacterCreateReq.allocate({
          displayName: newDisplayName.trim() || null,
          imageBase64: dataUrl,
          ollamaModel: ollamaModelOpt,
        })
        const res = await client.send(req.encode(), CharacterMutationRsp)
        if (!res.ok) {
          setErr(res.error.message)
          return
        }
        if (!res.data.ok) {
          setErr(res.data.message || '建立失敗')
          return
        }
        if (!res.data.data) {
          setErr('建立失敗')
          return
        }
        setNewDisplayName('')
        await loadList()
        setSelectedId(res.data.data.human.id)
        setDetail(res.data.data)
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
      } finally {
        setBusy(false)
      }
    },
    [loadList, newDisplayName, ollamaModelOpt],
  )

  const onAddFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !selectedId) return
      if (file.size > MAX_CHARACTER_IMAGE_BYTES) {
        setErr('檔案過大（上限 8 MB）')
        return
      }
      setBusy(true)
      setErr(null)
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const req = CharacterAddImageReq.allocate(selectedId, dataUrl, ollamaModelOpt)
        const res = await client.send(req.encode(), CharacterMutationRsp)
        if (!res.ok) {
          setErr(res.error.message)
          return
        }
        if (!res.data.ok) {
          setErr(res.data.message || '加圖失敗')
          return
        }
        if (!res.data.data) {
          setErr('加圖失敗')
          return
        }
        await loadList()
        setDetail(res.data.data)
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
      } finally {
        setBusy(false)
      }
    },
    [loadList, selectedId, ollamaModelOpt],
  )

  const onProfileRefresh = useCallback(async () => {
    if (!selectedId) return
    setBusy(true)
    setErr(null)
    const req = CharacterProfileRefreshReq.allocate(selectedId, ollamaModelOpt)
    const res = await client.send(req.encode(), CharacterMutationRsp)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    if (!res.data.ok || !res.data.data) {
      setErr(res.data.message || '整理摘要失敗')
      return
    }
    await loadList()
    setDetail(res.data.data)
  }, [loadList, selectedId, ollamaModelOpt])

  return {
    createFileRef,
    addFileRef,
    list,
    storeHint,
    selectedId,
    setSelectedId,
    detail,
    loadingList,
    loadingDetail,
    busy,
    err,
    setErr,
    loadList,
    newDisplayName,
    setNewDisplayName,
    ollamaPicked,
    setOllamaPicked,
    ollamaNames,
    ollamaErr,
    ollamaModelOpt,
    onCreateFileChange,
    onAddFileChange,
    onProfileRefresh,
  }
}
