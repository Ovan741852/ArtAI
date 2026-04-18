/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** 設為 `1` 時走 `MockHttpTransport`，不依賴後端 */
  readonly VITE_NET_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
