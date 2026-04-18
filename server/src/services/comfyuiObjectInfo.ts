/**
 * 呼叫本機 ComfyUI `GET /object_info`（節點型別與輸入欄位定義；回應體積可能很大）。
 * @see https://github.com/comfyanonymous/ComfyUI/blob/master/server.py
 */

const OBJECT_INFO_PATH = '/object_info'

export async function fetchComfyObjectInfo(comfyuiBaseUrl: string): Promise<unknown> {
  const base = comfyuiBaseUrl.replace(/\/+$/, '')
  const url = `${base}${OBJECT_INFO_PATH}`

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  const bodyText = await res.text()
  if (!res.ok) {
    const snippet = bodyText.length > 200 ? `${bodyText.slice(0, 200)}…` : bodyText
    throw new Error(`ComfyUI ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText) as unknown
  } catch {
    throw new Error('ComfyUI returned non-JSON body for /object_info')
  }

  if (data == null || typeof data !== 'object') {
    throw new Error('ComfyUI /object_info: expected a JSON object')
  }

  return data
}

type ObjectInfoCache = {
  refreshedAt: string
  cachedAtMs: number
  data: unknown
}

let objectInfoCache: ObjectInfoCache | null = null

export type ComfyObjectInfoResult = {
  objectInfo: unknown
  comfyuiBaseUrl: string
  fromCache: boolean
  refreshedAt: string
  nodeTypeCount: number
}

function countNodeTypes(info: unknown): number {
  if (info == null || typeof info !== 'object') return 0
  return Object.keys(info as Record<string, unknown>).length
}

/**
 * 帶記憶體 TTL 的 object_info；`force` 為 true 時略過快取。
 */
export async function getComfyObjectInfoCached(
  comfyuiBaseUrl: string,
  ttlMs: number,
  opts?: { force?: boolean },
): Promise<ComfyObjectInfoResult> {
  const force = opts?.force === true
  const now = Date.now()
  if (!force && ttlMs > 0 && objectInfoCache) {
    const age = now - objectInfoCache.cachedAtMs
    if (age >= 0 && age < ttlMs) {
      return {
        objectInfo: objectInfoCache.data,
        comfyuiBaseUrl,
        fromCache: true,
        refreshedAt: objectInfoCache.refreshedAt,
        nodeTypeCount: countNodeTypes(objectInfoCache.data),
      }
    }
  }

  const data = await fetchComfyObjectInfo(comfyuiBaseUrl)
  const refreshedAt = new Date().toISOString()
  objectInfoCache = {
    refreshedAt,
    cachedAtMs: now,
    data,
  }

  return {
    objectInfo: data,
    comfyuiBaseUrl,
    fromCache: false,
    refreshedAt,
    nodeTypeCount: countNodeTypes(data),
  }
}
