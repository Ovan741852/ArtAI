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
| `GET` | `/comfy/object_info` | 轉呼本機 ComfyUI 的 **`GET /object_info`**（節點型別與輸入欄位定義）。回應 **`objectInfo`** 體積可能很大，伺服器端有 **TTL 記憶體快取**（見 `COMFY_OBJECT_INFO_TTL_MS`）。成功時回傳 `ok`、`objectInfo`、`comfyuiBaseUrl`、**`fromCache`**、**`refreshedAt`**（ISO 8601）、**`nodeTypeCount`**（頂層鍵數量摘要）。Query：`force=1` 時略過快取並重新抓取。失敗時 **502**。 |

---

## Comfy Workflow 模板（ArtAI 內建）

模板為伺服器工作目錄下 **`data/workflow-templates/*.json`**（與本機 checkpoint 目錄檔 `catalog` 分開）。可用 **`WORKFLOW_TEMPLATES_DIR`** 覆寫為絕對路徑。檔名須為 `{id}.json` 且 JSON 內 **`id`** 欄位與檔名一致。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/workflows/templates` | 列出模板摘要：`templates[]` 每筆含 `id`、`titleZh`、`descriptionZh`、`tags`、`requiredPacks`、`whitelistKeys`。 |
| `GET` | `/workflows/templates/:id` | 單一模板。成功時 `human`（繁中與標籤）與 `machine`（`templateId`、`whitelistParams`、`workflow`；`workflow` 為 Comfy API **`prompt`** 形狀：`{ [nodeId]: { class_type, inputs } }`）。未知 `id` 時 **404**。 |

---

## Comfy Workflow 助手（Ollama）

依 **`GET /workflows/templates`** 與本機 **`GET /models/local/dump`** 同源之 Comfy checkpoint 列表組 prompt；並嘗試讀取 **`GET /comfy/object_info`** 快取以附 **節點型別數摘要**（Comfy 離線時 `objectInfoSummary` 可為 `{ ok: false, message }`）。使用者未選模板時，模型回傳之 **`proposedPatch` 會被清空**（避免非白名單鍵）；有 **`selectedTemplateId`** 時才會依白名單套用並回傳 **`resolvedWorkflow`**。

**Body（`POST …/chat` 與 `…/chat-stream` 相同）：**

- `messages`（必填）：`{ role: "user" \| "assistant", content: string }[]`，最後一則須為 `user`，內容不可為空字串。
- `ollamaModel`（選填）：未傳則使用 `OLLAMA_SUMMARY_MODEL`。
- `selectedTemplateId`（選填）：小寫 id（`[a-z0-9-]+`），須對應已存在模板；無效時 **404**。
- `localCheckpoint`（選填）：建議優先使用的 checkpoint 檔名字串。

**成功 JSON（非串流 `POST /workflows/assistant/chat`）：** `ok: true` 外加：

- `ollamaModel`、`selectedTemplateId`（無則 `null`）、`localCheckpoints`、`templates`（與列表端相同形狀之陣列）、`objectInfoSummary`（`{ ok: true, nodeTypeCount, refreshedAt, fromCache }` 或 `{ ok: false, message }`，或 Comfy 未呼叫時 `null`）。
- `assistant`：`replyZh`、`understandingZh?`、`confirmationOptionsZh[]`、`intentEn`（英文短字串鍵值）、`proposedPatch`（物件）、`suggestedTemplateId`（`string \| null`）。
- `resolvedWorkflow`：已選模板且 patch 套用成功時為 **prompt 圖**；否則 `null`。
- `patchApply`：已選模板時為 `{ ok: true, appliedKeys, ignoredKeys }` 或 `{ ok: false, message }`；未選模板時 `null`。

**串流 `POST /workflows/assistant/chat-stream`：** 回應 **`Content-Type: application/x-ndjson`**。每行一個 JSON：① `{ "type": "delta", "text": "…" }`；② `{ "type": "final", "ok": true, … }` 欄位與非串流成功 JSON 一致；③ `{ "type": "error", "ok": false, "message": "…" }`。Body 驗證失敗（含 **404** 模板）仍回 **一般 JSON**，不進入 NDJSON。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/workflows/assistant/chat` | Workflow 模板助手，單次 JSON。 |
| `POST` | `/workflows/assistant/chat-stream` | 同上，NDJSON 串流。 |

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
| `POST` | `/civitai/checkpoint/summary` | 依**單一**本機 checkpoint 檔名搜尋 Civitai、擷取描述與版本資訊後，交給本機 **Ollama** 產生**英文**用法摘要。Body：`{ "checkpoint": "foo.safetensors", "ollamaModel"?: "…", "searchQuery"?: "…" }`。 |
| `POST` | `/civitai/models/suggest-from-descriptions` | 依多則畫面描述交 **Ollama** 推斷 Civitai 用 `tag`／`query` 搜尋用的字串，再以官方 `GET /api/v1/models` 依 **Most Downloaded + AllTime** 合併去重，回傳最熱門的模型列表（預設 5 筆）。Body：`{ "descriptions": "…" \| string[], "ollamaModel"?: "…", "types"?: "Checkpoint", "nsfw"?: boolean, "perSearchLimit"?: number, "limit"?: number }`。 |
| `POST` | `/civitai/checkpoint/tag-assistant/chat` | **Checkpoint 需求助手（多輪，一次回 JSON）**：與 `chat-stream` 相同邏輯但以單一 JSON 回應（無串流）。Body 與 `chat-stream` 相同。 |
| `POST` | `/civitai/checkpoint/tag-assistant/chat-stream` | **Checkpoint 需求助手（NDJSON 串流）**：Body 與 `…/chat` 相同。回應 **`Content-Type: application/x-ndjson`**，每行一個 JSON：① `{ "type": "delta", "text": "…" }`（Ollama 產生片段）；② `{ "type": "final", "ok": true, … }` 欄位與非串流成功 JSON 一致（`ollamaModel`、`imageAttached`、`localCheckpoints`、`assistant`、`recommendedModels`）；③ `{ "type": "error", "ok": false, "message": "…" }`。先驗證 body 失敗時仍回 **一般 JSON**（400／502）而非串流。 |
| `POST` | `/civitai/model-bundles/assistant/chat` | **模型套組採購助手（多輪，一次回 JSON）**：見下方「模型套組採購助手」小節之 Body 與回應欄位；無串流。 |
| `POST` | `/civitai/model-bundles/assistant/chat-stream` | **模型套組採購助手（NDJSON 串流）**：Body 與 `…/chat` 相同；`delta`／`final`／`error` 列格式同其他 NDJSON 端點。 |
| `GET` | `/civitai/models/search` | 關鍵字搜尋 Civitai `GET /api/v1/models`。必填其一：`query` 或 `tag`。可選：`types`、`sort`、`period`、`baseModels`、`limit`、`nsfw`；`summarize=1` 時會用 Ollama 總結前幾筆。 |
| `GET` | `/civitai/models/:id` | 依數字模型 ID 取得 Civitai `GET /api/v1/models/{id}`，回傳精簡後的 `model` 物件（description 去 HTML、含版本預覽等）。 |

### 模型套組採購助手（Ollama + Civitai）

與 **Checkpoint 需求助手**分離：**不**附本機 checkpoint 清單；由 Ollama 產出 **1–3 組**採購向 stack，每組含 **一個 checkpoint 搜尋條件**與 **0–2 個 LoRA 搜尋條件**（皆為英文 `modelTags`／`searchQueries`），伺服器再依條件向 Civitai 合併搜尋（checkpoint 用 `types=Checkpoint`，LoRA 用 `types=LORA`），排序策略與 `suggest-from-descriptions` 相同（Most Downloaded + AllTime）。

**Body（`POST …/chat` 與 `…/chat-stream` 相同）：**

- `messages`（必填）：`{ role: "user" \| "assistant", content: string }[]`，最後一則須為 `user`；可與 `imageBase64` 搭配時允許最後一則 `user` 的 `content` 為空字串（僅圖）。
- `ollamaModel`（選填）：未傳則使用 `OLLAMA_SUMMARY_MODEL`。
- `recommendLimitPerSlot`（選填）：每個 slot（單一 checkpoint 或單一 LoRA）回傳的 Civitai 模型筆數上限，預設 **4**，範圍 **1–12**。
- `perSearchLimit`（選填）：每次 tag／query 向 Civitai 取的筆數上限，預設 **12**，範圍 **1–100**。
- `nsfw`（選填）：預設 `true`；傳 `false` 時關閉 NSFW。
- `imageBase64`（選填）：同 checkpoint tag assistant；須使用支援視覺的 Ollama 模型。

**成功 JSON（非串流 `POST /civitai/model-bundles/assistant/chat`）：** `ok: true` 外加：

- `ollamaModel`、`imageAttached`（boolean）。
- `assistant`：`{ "replyZh": string }`（繁中短回覆）。
- `bundles`：陣列長度 **1–3**。每筆含：
  - `titleZh`、`noteZh`（選填，字串）
  - `checkpoint`：`modelTags`、`searchQueries`、`recommendedModels`（與 tag 助手推薦列相同精簡形狀之陣列）
  - `loras`：陣列，元素同 `checkpoint` 欄位結構（搜尋結果為 LoRA）

**串流 `POST /civitai/model-bundles/assistant/chat-stream`：** 回應 **`Content-Type: application/x-ndjson`**。每行一個 JSON：① `{ "type": "delta", "text": "…" }`；② `{ "type": "final", "ok": true, … }` 欄位與非串流成功 JSON 一致；③ `{ "type": "error", "ok": false, "message": "…" }`。先驗證 body 失敗時仍回 **一般 JSON**（400／502）而非串流。

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
| `GET` | `/models/local/dump` | 回傳 `sources`（comfyui / ollama / checkpointCatalog）、`summary` 計數、**`refreshedAt`**、**`fromCache`**、**`staleAt`**（快取預計過期之 UTC 時間，TTL 為 0 時為 null）。Query：`force=1` 時略過快取並重新抓取 ComfyUI 與 Ollama。`checkpointCatalog.entries[]` 每筆含 **`civitaiTags`**、**`civitaiDescriptionPreview`**（Civitai 模型描述去 HTML 後之前綴，約 12k 字元內；多為英文）、**`civitaiTrainedWords`**、**`civitaiBaseModel`**、**`civitaiCreatorUsername`**（皆來自已同步之目錄 JSON 內 `model`）。 |

---

## 圖像摳圖（自動）

上傳一張圖後，伺服器會以 **Ollama 視覺模型**（若可用）讀圖並做簡短分類，再依 **本機 ComfyUI 已安裝節點**、**Remove.bg**（選填金鑰）、**本機 ONNX（@imgly/background-removal）** 的可用性排出優先序，**依序嘗試**直到成功為止。

**Body（`POST /images/matting/auto`）：**

- `imageBase64`（必填）：base64 圖檔；可含 `data:image/png;base64,` 前綴。解碼後上限 **8 MB**。支援常見 **PNG／JPEG／WebP** 魔數。
- `ollamaModel`（選填）：讀圖分類用模型；須為 Ollama 支援**視覺**者較佳。省略時使用 `OLLAMA_SUMMARY_MODEL`。若視覺呼叫失敗，分類會退回預設並於 `warnings` 附註（仍會繼續摳圖）。

**成功 JSON：** `ok: true` 外加：

- `classification`：`primarySubject`（`single_human_portrait` \| `multiple_humans` \| `product_object` \| `scene_mixed`）、`edgeDifficulty`（`simple` \| `moderate` \| `hard`）、`preferQualityOverSpeed`（boolean）。
- `chosenExecutor`：`comfy` \| `remove_bg` \| `local_onnx`（實際成功的那一個）。
- `chosenReasonZh`：繁中簡短說明為何選此路徑。
- `triedExecutors`：嘗試順序標籤（例如 `comfy:某節點類名`、`remove_bg`、`local_onnx`）。
- `comfyNodeType`：成功且為 Comfy 時為該次使用的 `class_type` 字串；否則 `null`。
- `ollamaModelUsed`、`visionClassificationUsed`（boolean）。
- `imagePngBase64`：結果 **PNG**（透明背景），純 base64、**無** data URL 前綴。
- `warnings`：字串陣列（例如後端失敗改試下一個時的提示）。

**Comfy 偵測：** 伺服器讀取快取之 **`GET /comfy/object_info`** 同源資料；若節點型別名稱符合內建關鍵字（精細類：如 BiRefNet／isnet…；一般類：如 rembg／remove background…），且該節點在 `object_info` 中可 **單一 `IMAGE` 輸入** 自動串 `LoadImage → 節點 → SaveImage`，才會納入 Comfy 候選。若你的自訂節點名稱不含關鍵字，將不會被自動選用（仍可走 Remove.bg 或本機 ONNX）。

**錯誤：** Body 無效 **400**；無任何可用後端 **500**；所有候選皆失敗 **502**。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/images/matting/auto` | 讀圖、自動選擇摳圖後端並回傳 PNG base64。 |

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
| `COMFY_OBJECT_INFO_TTL_MS` | `GET /comfy/object_info` 記憶體快取 TTL（毫秒）；未設定時預設與 **`LOCAL_MODELS_DUMP_TTL_MS`** 相同（再未設定則 `30000`）；`0` 表示每次請求皆轉呼 ComfyUI。 |
| `WORKFLOW_TEMPLATES_DIR` | Workflow 模板 JSON 目錄（選填）；預設為執行時 `cwd` 下 **`data/workflow-templates`**。 |
| `REMOVE_BG_API_KEY` | Remove.bg API Key（選填）；若設定且分類適用，會列入高品質雲端去背候選。 |

CORS：生產環境可設定 `ALLOWED_ORIGINS`（逗號分隔）。
