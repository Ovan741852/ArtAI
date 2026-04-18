import type { IHttpRequest } from './types'

export type PreparedRequest = Pick<IHttpRequest, 'method' | 'headers'> & {
  url: string
  body?: string | undefined
}

function getContentType(headers: Record<string, string>): string | undefined {
  return headers['Content-Type'] ?? headers['content-type']
}

/**
 * 將 IHttpRequest.body 正規成 fetch 可用的字串，並與 Content-Type 對齊。
 */
export function prepareRequestForFetch(req: IHttpRequest, resolvedUrl: string): PreparedRequest {
  const headers = { ...req.headers }
  let body: string | undefined

  if (req.method === 'GET') {
    return { url: resolvedUrl, method: req.method, headers, body: undefined }
  }

  const raw = req.body
  if (raw == null || raw === '') {
    return { url: resolvedUrl, method: req.method, headers, body: undefined }
  }

  const contentType = getContentType(headers)

  if (raw instanceof URLSearchParams) {
    body = raw.toString()
    if (!contentType) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return { url: resolvedUrl, method: req.method, headers, body }
  }

  if (typeof raw === 'string') {
    body = raw
    return { url: resolvedUrl, method: req.method, headers, body }
  }

  if (contentType?.includes('application/json')) {
    body = JSON.stringify(raw)
    return { url: resolvedUrl, method: req.method, headers, body }
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    body = new URLSearchParams(
      Object.entries(raw).reduce<Record<string, string>>((acc, [k, v]) => {
        if (v != null) acc[k] = String(v)
        return acc
      }, {}),
    ).toString()
    return { url: resolvedUrl, method: req.method, headers, body }
  }

  body = JSON.stringify(raw)
  if (!contentType) {
    headers['Content-Type'] = 'application/json'
  }
  return { url: resolvedUrl, method: req.method, headers, body }
}
