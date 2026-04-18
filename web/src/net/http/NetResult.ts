export type NetErrorKind = 'http' | 'parse' | 'transport'

export type NetError = {
  kind: NetErrorKind
  message: string
  status?: number
  cause?: unknown
}

export type NetResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NetError }

export function netOk<T>(data: T): NetResult<T> {
  return { ok: true, data }
}

export function netErr(error: NetError): NetResult<never> {
  return { ok: false, error }
}

export function toNetError(e: unknown): NetError {
  if (e && typeof e === 'object' && 'kind' in e && 'message' in e) {
    const o = e as NetError
    return { kind: o.kind, message: String(o.message), status: o.status, cause: o.cause }
  }
  if (e instanceof Error) {
    return { kind: 'transport', message: e.message, cause: e }
  }
  return { kind: 'transport', message: String(e), cause: e }
}
