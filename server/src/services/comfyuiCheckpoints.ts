/**
 * 呼叫本機 ComfyUI HTTP API（與官方 `server.py` 的 `GET /models/{folder}` 對齊）。
 * @see https://github.com/comfyanonymous/ComfyUI/blob/master/server.py
 */

const CHECKPOINTS_PATH = '/models/checkpoints'

export async function fetchCheckpointList(comfyuiBaseUrl: string): Promise<string[]> {
  const base = comfyuiBaseUrl.replace(/\/+$/, '')
  const url = `${base}${CHECKPOINTS_PATH}`

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
    throw new Error('ComfyUI returned non-JSON body for /models/checkpoints')
  }

  if (!Array.isArray(data)) {
    throw new Error('ComfyUI /models/checkpoints: expected JSON array of filenames')
  }

  return data.map((x) => String(x))
}
