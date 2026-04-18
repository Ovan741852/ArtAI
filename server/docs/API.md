# ArtAI Server HTTP API

預設監聽埠為 **8787**（可用環境變數 `PORT` 覆寫）。以下路徑皆為相對於伺服器根 URL，例如 `http://127.0.0.1:8787`。

---

## 系統

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/` | 健康用探測，回傳問候 JSON。 |
| `GET` | `/health` | 存活檢查，`{ "status": "ok" }`。 |

---

## ComfyUI

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/comfy/checkpoints` | 轉呼本機 ComfyUI 的 `GET /models/checkpoints`，列出 `models/checkpoints` 目錄下的檔名（含副檔名）。需設定 `COMFYUI_BASE_URL` 或 `COMFYUI_HOST`。失敗時 **502**。 |

---

## 本機 Checkpoint 目錄（Comfy + Civitai）

用來建立並維護「本機實際擁有的 checkpoint」對應到 Civitai 上的模型介紹與 metadata，資料存在伺服器工作目錄下的 JSON 檔（預設 `data/owned-checkpoints.json`）。可用環境變數 **`OWNED_CHECKPOINTS_STORE`** 指定絕對或相對路徑。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/catalog/checkpoints` | 讀取已同步的目錄：每筆含本機檔名、Civitai 模型 ID、對應品質、搜尋關鍵字、同步時間，以及與 `GET /civitai/models/:id` 相同結構的 `model` 摘要欄位。 |
| `POST` | `/catalog/checkpoints/sync-from-comfy` | **同步**：先向 ComfyUI 取得 checkpoint 列表，對每個檔名在 Civitai 搜尋 `Checkpoint` 並挑出最佳匹配，再以 Civitai **`GET /api/v1/models/{id}`**（與對外 `GET /civitai/models/:id` 同一資料來源）拉完整資料後寫入 JSON。回傳成功筆數、失敗列表等。單檔同步失敗時，若目錄內已有該檔舊資料會**保留舊筆**並在 `failures` 標示 `keptStale: true`。 |

**何時用：** 換機、裝了新模型、或希望前端／其他服務能離線讀「本機有哪些檔、各自在 Civitai 的說明」時，呼叫 `sync-from-comfy` 一次即可更新本地目錄。

---

## Civitai（轉發官方 REST）

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/civitai/checkpoint/summary` | 依**單一**本機 checkpoint 檔名搜尋 Civitai、擷取描述與版本資訊後，交給本機 **Ollama** 產生繁中用法摘要。Body：`{ "checkpoint": "foo.safetensors", "ollamaModel"?: "…", "searchQuery"?: "…" }`。 |
| `POST` | `/civitai/models/suggest-from-descriptions` | 依多則畫面描述交 **Ollama** 推斷 Civitai 用 `tag`／`query` 搜尋用的字串，再以官方 `GET /api/v1/models` 依 **Most Downloaded + AllTime** 合併去重，回傳最熱門的模型列表（預設 5 筆）。Body：`{ "descriptions": "…" \| string[], "ollamaModel"?: "…", "types"?: "Checkpoint", "nsfw"?: boolean, "perSearchLimit"?: number, "limit"?: number }`。 |
| `GET` | `/civitai/models/search` | 關鍵字搜尋 Civitai `GET /api/v1/models`。必填其一：`query` 或 `tag`。可選：`types`、`sort`、`period`、`baseModels`、`limit`、`nsfw`；`summarize=1` 時會用 Ollama 總結前幾筆。 |
| `GET` | `/civitai/models/:id` | 依數字模型 ID 取得 Civitai `GET /api/v1/models/{id}`，回傳精簡後的 `model` 物件（description 去 HTML、含版本預覽等）。 |

Civitai 認證：可選環境變數 **`CIVITAI_API_KEY`**（或 `CIVITAI_API_TOKEN`），以 `Authorization: Bearer …` 送出。

---

## Ollama

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/ollama/models` | 轉呼 `GET /api/tags`，列出本機已安裝的 Ollama 模型。 |

---

## 本機模型彙整（Dump）

一次取得 **ComfyUI checkpoints**、**Ollama 已安裝模型**、以及本機 **checkpoint 目錄 JSON**（與 `GET /catalog/checkpoints` 同源之摘要欄位）。並回傳 **`refreshedAt`**：上次成功建立此快照的時間（ISO 8601）；若命中記憶體快取則 **`fromCache`: true**，`refreshedAt` 仍為該快取建立當下的時間。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/models/local/dump` | 回傳 `sources`（comfyui / ollama / checkpointCatalog）、`summary` 計數、**`refreshedAt`**、**`fromCache`**、**`staleAt`**（快取預計過期之 UTC 時間，TTL 為 0 時為 null）。Query：`force=1` 時略過快取並重新抓取 ComfyUI 與 Ollama。 |

---

## Demo

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/demo/echo` | 解析 JSON body 後原樣包在 `echo` 內回傳，供前端通訊測試。 |

---

## 相關環境變數（摘要）

| 變數 | 說明 |
|------|------|
| `PORT` | HTTP 埠，預設 `8787`。 |
| `COMFYUI_BASE_URL` / `COMFYUI_HOST` | ComfyUI 位址。 |
| `OLLAMA_BASE_URL` / `OLLAMA_HOST` | Ollama 位址。 |
| `OLLAMA_SUMMARY_MODEL` | 摘要用預設模型名。 |
| `CIVITAI_BASE_URL` | 預設 `https://civitai.com`。 |
| `CIVITAI_API_KEY` | Civitai API Token（選填）。 |
| `OWNED_CHECKPOINTS_STORE` | 本機 checkpoint 目錄 JSON 路徑（選填，預設為執行時 `cwd` 下 `data/owned-checkpoints.json`）。 |
| `LOCAL_MODELS_DUMP_TTL_MS` | `GET /models/local/dump` 記憶體快取 TTL（毫秒）；預設 `30000`，設 `0` 表示每次請求皆重新抓取。 |

CORS：生產環境可設定 `ALLOWED_ORIGINS`（逗號分隔）。
