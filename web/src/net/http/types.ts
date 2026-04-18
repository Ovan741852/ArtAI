export type HttpBody =
  | string
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined>

export type IHttpRequest = {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  responseType: 'text' | 'json'
  body?: HttpBody
}

export abstract class HttpPacket {
  /**
   * 永遠收到已 normalize 的 payload（見 normalizePacketPayload）。
   */
  abstract decode(payload: unknown): void
}

/** 由子類別的 onAllocate 推斷 allocate 參數，避免 static 引用類別型參數。 */
export type AllocateParams<T extends HttpRequest> = T extends {
  onAllocate?: (...args: infer P) => void
}
  ? P extends unknown[]
    ? P
    : []
  : []

export abstract class HttpRequest {
  static allocate<T extends HttpRequest>(this: new () => T, ...params: AllocateParams<T>): T {
    const instance = new this()
    const alloc = instance.onAllocate
    if (alloc) {
      // 必須帶上 instance：若先把方法存成變數再呼叫，執行時 `this` 會是 undefined。
      Reflect.apply(alloc, instance, params)
    }
    return instance
  }

  abstract get url(): string
  abstract get method(): 'GET' | 'POST'
  abstract get headers(): Record<string, string>
  abstract get responseType(): 'text' | 'json'
  /** 可省略：GET 或無 body 的 POST */
  get body(): HttpBody | undefined {
    return undefined
  }

  encode(): IHttpRequest {
    return {
      url: this.url,
      method: this.method,
      headers: this.headers,
      responseType: this.responseType,
      body: this.body,
    }
  }

  onAllocate?(...args: unknown[]): void
  onRelease?(): void
}
