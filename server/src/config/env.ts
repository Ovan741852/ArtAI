export type ServerEnv = {
  /** HTTP listen port */
  port: number
  nodeEnv: string
  /**
   * Production: comma-separated allowed `Origin` values.
   * Development: ignored; CORS uses permissive defaults.
   */
  allowedOrigins: string[]
  /**
   * ComfyUI HTTP 根位址（無尾隨斜線），例如 `http://127.0.0.1:8188`。
   * 對應 ComfyUI 內建 `GET /models/checkpoints`。
   */
  comfyuiBaseUrl: string
  /**
   * Ollama HTTP 根位址（無尾隨斜線），例如 `http://localhost:11434`。
   * 對應 Ollama `GET /api/tags`。
   */
  ollamaBaseUrl: string
  /** Civitai 網站根（預設官方 `https://civitai.com`）。 */
  civitaiBaseUrl: string
  /**
   * Civitai API Key（選填）。帳戶設定可產生；請求時使用官方文件之 `Authorization: Bearer {api_key}`。
   * @see https://github.com/civitai/civitai/wiki/REST-API-Reference#authorization
   */
  civitaiApiKey: string | undefined
  /** 呼叫 Ollama `/api/generate` 做摘要時的預設模型名。 */
  ollamaSummaryModel: string
  /**
   * `GET /models/local/dump` 記憶體快取 TTL（毫秒）。`0` 表示每次請求都重新抓取。
   * 環境變數：`LOCAL_MODELS_DUMP_TTL_MS`（預設 30000）。
   */
  localModelsDumpTtlMs: number
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback
  return n
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw == null || raw.trim() === '') return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeHttpBase(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(t)) return t
  return `http://${t}`
}

/** `{SERVICE}_BASE_URL` 優先；否則 `{SERVICE}_HOST` + 預設 host，自動補 `http://`。 */
function resolveHttpServiceBase(opts: {
  explicitBaseUrl: string | undefined
  host: string | undefined
  defaultHost: string
}): string {
  const ex = opts.explicitBaseUrl?.trim()
  const raw = ex && ex !== '' ? ex : (opts.host?.trim() || opts.defaultHost)
  return normalizeHttpBase(raw)
}

function resolveCivitaiBaseUrl(): string {
  const explicit = process.env.CIVITAI_BASE_URL?.trim()
  if (explicit && explicit !== '') {
    return explicit.replace(/\/+$/, '')
  }
  return 'https://civitai.com'
}

export function loadServerEnv(): ServerEnv {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  return {
    port: parsePort(process.env.PORT, 8787),
    nodeEnv,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    comfyuiBaseUrl: resolveHttpServiceBase({
      explicitBaseUrl: process.env.COMFYUI_BASE_URL,
      host: process.env.COMFYUI_HOST,
      defaultHost: '127.0.0.1:8188',
    }),
    ollamaBaseUrl: resolveHttpServiceBase({
      explicitBaseUrl: process.env.OLLAMA_BASE_URL,
      host: process.env.OLLAMA_HOST,
      defaultHost: 'localhost:11434',
    }),
    civitaiBaseUrl: resolveCivitaiBaseUrl(),
    civitaiApiKey:
      process.env.CIVITAI_API_KEY?.trim() ||
      process.env.CIVITAI_API_TOKEN?.trim() ||
      undefined,
    ollamaSummaryModel: process.env.OLLAMA_SUMMARY_MODEL?.trim() || 'llama3.2',
    localModelsDumpTtlMs: parseNonNegativeInt(process.env.LOCAL_MODELS_DUMP_TTL_MS, 30_000),
  }
}
