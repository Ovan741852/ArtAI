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
| `POST` | `/workflows/templates/:id/run` | **執行模板**：讀取 `id` 對應 JSON，將 **`patch`** 依白名單套入預設 `workflow` 後送 **ComfyUI** `/prompt`，輪詢至第一張輸出圖。Body：`patch`（選填，物件，可為 `{}`）、`timeoutMs`（選填，毫秒，預設 **600000**，範圍 **10000–1800000**）、**`referenceImagePngBase64`**（選填）：有值時解碼並 **`POST /upload/image`** 上傳至 Comfy，再將 workflow 中**第一個** `LoadImage` 節點之 `inputs.image` 設為回傳檔名（供 **`basic-img2img`** 等）；可含 data URL 前綴，規則同摳圖 API；模板不含 `LoadImage` 時傳此欄位為 **400**。成功時 `ok: true`、`imagePngBase64`（PNG 純 base64、**無** data URL 前綴）、`patchApply`（`{ ok: true, appliedKeys, ignoredKeys }`）。`patch` 含非白名單鍵時仍會被忽略；型別不符等套用失敗時 **400**。Comfy 失敗或逾時 **502**。需設定 `COMFYUI_BASE_URL`／`COMFYUI_HOST`。 |

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
- `assistant`：`replyZh`（使用者可見短句；Ollama 可省略或留空，伺服器會用 `understandingZh` 或預設英文一句補上）、`understandingZh?`、`confirmationOptionsZh[]`、`intentEn`（英文短字串鍵值）、`proposedPatch`（物件）、`suggestedTemplateId`（`string \| null`）。
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
| `POST` | `/civitai/checkpoint/tag-assistant/chat-stream` | **Checkpoint 需求助手（NDJSON 串流）**：Body 與 `…/chat` 相同。回應 **`Content-Type: application/x-ndjson`**，每行一個 JSON：① `{ "type": "delta", "text": "…" }`（Ollama 產生片段）；② `{ "type": "final", "ok": true, … }` 欄位與非串流成功 JSON 一致（`ollamaModel`、`imageAttached`、**`attachedImageCount`**、`localCheckpoints`、`assistant`、`recommendedModels`、**`resourceExtras`**）；③ `{ "type": "error", "ok": false, "message": "…" }`。先驗證 body 失敗時仍回 **一般 JSON**（400／502）而非串流。 |
| `POST` | `/civitai/model-bundles/assistant/chat` | **模型套組採購助手（多輪，一次回 JSON）**：見下方「模型套組採購助手」小節之 Body 與回應欄位；無串流。 |
| `POST` | `/civitai/model-bundles/assistant/chat-stream` | **模型套組採購助手（NDJSON 串流）**：Body 與 `…/chat` 相同；`delta`／`final`／`error` 列格式同其他 NDJSON 端點。 |
| `GET` | `/civitai/models/search` | 關鍵字搜尋 Civitai `GET /api/v1/models`。必填其一：`query` 或 `tag`。可選：`types`、`sort`、`period`、`baseModels`、`limit`、`nsfw`；`summarize=1` 時會用 Ollama 總結前幾筆。 |
| `GET` | `/civitai/models/:id` | 依數字模型 ID 取得 Civitai `GET /api/v1/models/{id}`，回傳精簡後的 `model` 物件（description 去 HTML、含版本預覽等）。 |

### Checkpoint 需求助手（Body、參考圖與成功欄位）

**Body（`POST /civitai/checkpoint/tag-assistant/chat` 與 `…/chat-stream` 相同）：**

- `messages`（必填）：`{ role: "user" \| "assistant", content: string }[]`，最後一則須為 `user`；當本請求帶有至少一張有效參考圖時，允許最後一則 `user` 的 `content` 為空字串（僅圖）。
- `ollamaModel`（選填）：未傳則使用 `OLLAMA_SUMMARY_MODEL`。
- `recommendLimit`（選填）：Civitai Checkpoint 推薦筆數上限，預設 **5**，範圍 **1–12**。
- `perSearchLimit`（選填）：每次 tag／query 向 Civitai 取的筆數上限，預設 **12**，範圍 **1–100**。
- `nsfw`（選填）：預設 `true`；傳 `false` 時關閉 NSFW。
- `imageBase64`（選填）：單張參考圖 base64（可含 `data:image/...;base64,` 前綴）；解碼後單張上限 **8 MB**。送 Ollama `/api/generate` 之 `images`；須使用支援**視覺**的模型。
- `imageBase64s`（選填）：`string[]`，多張參考圖；每個元素規則與 `imageBase64` 相同；陣列內空字串會略過。若同時傳 `imageBase64` 與 `imageBase64s`，伺服器合併順序為 **`[imageBase64, ...imageBase64s]`**（便於除錯）。合併後總張數超過 **6** 時 **400**。
- 多張圖是否皆被視覺模型有效利用，**依 Ollama 模型與版本而定**；ArtAI 僅負責傳遞 `images` 陣列。

**成功 JSON（非串流）：** `ok: true` 外加 `ollamaModel`、`imageAttached`（boolean）、**`attachedImageCount`**（0–6，實際送入 Ollama 的張數）、`localCheckpoints`、`assistant`（`replyZh`、`modelTags`、`searchQueries`；`replyZh` 若 Ollama 省略或空字串，伺服器依 `modelTags`／`searchQueries` 組一句英文後備）、`recommendedModels`、`resourceExtras`（見下節）。

### Checkpoint 需求助手（`resourceExtras`）

非串流／串流 `final` 除 `assistant`、`recommendedModels`（Checkpoint）外，另含 **`resourceExtras`**：陣列（最多 6 筆），每筆為 `{ "kind": "lora" \| "textual_inversion" \| "controlnet" \| "workflow", "titleZh": string, "detailZh"?: string, "modelTags"?: string[], "searchQueries"?: string[], "recommendedModels": … }`。Ollama 在 JSON 內填寫 `kind`／`titleZh`／`detailZh` 與（若適用）英文 `modelTags`／`searchQueries`；伺服器對 **`lora`**、**`textual_inversion`** 以 Civitai `types=LORA` 或 `TextualInversion` 合併搜尋後寫入 `recommendedModels`；**`controlnet`**、**`workflow`** 通常僅有說明文字，無 Civitai 列。

### 模型套組採購助手（Ollama + Civitai）

與 **Checkpoint 需求助手**分離：**不**附本機 checkpoint 清單；由 Ollama 產出 **1–3 組**採購向 stack，每組含 **一個 checkpoint 搜尋條件**與 **1–2 個 LoRA 搜尋條件**（皆為英文 `modelTags`／`searchQueries`；Ollama 若回傳空 `loras`，伺服器會依該組 checkpoint 的 tag／query **自動補上一筆** LoRA slot 再搜 Civitai），checkpoint 用 `types=Checkpoint`，LoRA 用 `types=LORA`，排序策略與 `suggest-from-descriptions` 相同（Most Downloaded + AllTime）。

**Body（`POST …/chat` 與 `…/chat-stream` 相同）：**

- `messages`（必填）：`{ role: "user" \| "assistant", content: string }[]`，最後一則須為 `user`；當本請求帶有至少一張有效參考圖時，允許最後一則 `user` 的 `content` 為空字串（僅圖）。
- `ollamaModel`（選填）：未傳則使用 `OLLAMA_SUMMARY_MODEL`。
- `recommendLimitPerSlot`（選填）：每個 slot（單一 checkpoint 或單一 LoRA）回傳的 Civitai 模型筆數上限，預設 **4**，範圍 **1–12**。
- `perSearchLimit`（選填）：每次 tag／query 向 Civitai 取的筆數上限，預設 **12**，範圍 **1–100**。
- `nsfw`（選填）：預設 `true`；傳 `false` 時關閉 NSFW。
- `imageBase64`（選填）、`imageBase64s`（選填）：與 **Checkpoint 需求助手**小節「Body、參考圖」相同（合併順序、每張 8 MB、最多 6 張、須視覺模型）。

**成功 JSON（非串流 `POST /civitai/model-bundles/assistant/chat`）：** `ok: true` 外加：

- `ollamaModel`、`imageAttached`（boolean）、**`attachedImageCount`**（0–6）。
- `assistant`：`{ "replyZh": string }`（Ollama 可省略；空時伺服器用第一組 bundle 的 `titleZh` 補上）。
- `bundles`：陣列長度 **1–3**。每筆含：
  - `titleZh`、`noteZh`（選填，字串）
  - `checkpoint`：`modelTags`、`searchQueries`、`recommendedModels`（與 tag 助手推薦列相同精簡形狀之陣列）
  - `loras`：陣列（至少一筆；可能含伺服器依 checkpoint 自動補的 slot），元素同 `checkpoint` 欄位結構（搜尋結果為 LoRA）
- `resourceExtras`：與上節 **Checkpoint 需求助手**之 `resourceExtras` 形狀相同（可為空陣列）；用於套組以外的延伸條列（如 ControlNet 說明、額外 LoRA 主題），`lora`／`textual_inversion` 列會附 Civitai 搜尋結果。

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

上傳一張圖後，伺服器會以 **Ollama 視覺模型**（若可用）讀圖並做簡短分類，再依 **本機 ComfyUI 已安裝節點**、**本機 ONNX（@imgly/background-removal）** 排出優先序，**依序嘗試**直到成功為止。

**Body（`POST /images/matting/auto`）：**

- `imageBase64`（必填）：base64 圖檔；可含 `data:image/png;base64,` 前綴。解碼後上限 **8 MB**。支援常見 **PNG／JPEG／WebP** 魔數。
- `ollamaModel`（選填）：讀圖分類用模型；須為 Ollama 支援**視覺**者較佳。省略時使用 `OLLAMA_SUMMARY_MODEL`。若視覺呼叫失敗，分類會退回預設並於 `warnings` 附註（仍會繼續摳圖）。
- `enhancements`（選填）：物件。`edgeRefine: true` 時，第一輪成功後會以 **原圖** 與第一輪 PNG 對齊尺寸，在 **alpha 半透明邊界帶** 內將 RGB 向原圖混合（保留第一輪 alpha），修飾邊緣糊／輕溢色（**Sharp**，不依賴第二輪 WASM 去背）。省略或 `false` 則僅一輪。

**成功 JSON：** `ok: true` 外加：

- `classification`：`primarySubject`（`single_human_portrait` \| `multiple_humans` \| `product_object` \| `scene_mixed`）、`edgeDifficulty`（`simple` \| `moderate` \| `hard`）、`preferQualityOverSpeed`（boolean）。
- `chosenExecutor`：`comfy` \| `local_onnx`（實際成功的那一個）。
- `chosenReasonZh`：繁中簡短說明為何選此路徑。
- `triedExecutors`：嘗試順序標籤（例如 `comfy:某節點類名`、`local_onnx`）。
- `comfyNodeType`：成功且為 Comfy 時為該次使用的 `class_type` 字串；否則 `null`。
- `ollamaModelUsed`、`visionClassificationUsed`（boolean）。
- `imagePngBase64`：結果 **PNG**（透明背景），純 base64、**無** data URL 前綴。
- `warnings`：字串陣列（例如後端失敗改試下一個時的提示）。
- `enhancementSecondPassUsed`（boolean）：是否實際執行過至少一步強化第二輪。
- `enhancementAppliedStepsZh`：字串陣列，已執行之強化步驟繁中說明（無第二輪時為 `[]`）。
- `enhancementsRequested`：`{ edgeRefine }` 布林（未帶 `enhancements` 則 `edgeRefine: false`）。

**Comfy 偵測：** 伺服器讀取快取之 **`GET /comfy/object_info`** 同源資料；若節點型別名稱符合內建關鍵字（精細類：如 BiRefNet／isnet…；一般類：如 rembg／remove background…），且該節點在 `object_info` 之 **`input.required` 恰好一個 `IMAGE`**、其餘必填皆為可自動填之型別（`BOOLEAN`／`INT`／`FLOAT`／`STRING`／選項下拉），才會納入 Comfy 候選。**需要額外連線的型別**（例如 `rembg_session` 的 `ImageRemoveBackground+`）會排除，改試下一後端。節點名稱不含關鍵字者不會被選用（仍可走本機 ONNX）。

**錯誤：** Body 無效 **400**；無任何可用後端 **500**；所有候選皆失敗 **502**；第一輪成功但 **強化第二輪** 拋錯亦為 **502**（`message` 以「強化第二輪失敗：…」開頭）。一般 **502** JSON 除 `message` 外可含 **`warnings`**、**`attemptErrors`**、**`triedExecutors`**。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/images/matting/auto` | 讀圖、自動選擇摳圖後端並回傳 PNG base64。 |

---

## 創意閉環（規劃層 + 資源盤點）

獨立於 **Checkpoint 需求助手**／**模型套組採購助手**。**模板選擇**：未傳 **`selectedTemplateId`** 時，伺服器依「是否有使用者參考圖（僅 `imageBase64`／`imageBase64s`，不含 `lastOutputPngBase64`）」自動選 **`basic-img2img`**（有圖且伺服器有該模板）或 **`basic-txt2img`**；缺 img2img 模板時改走文生圖並於 **`warnings`** 附註。**生圖**請呼叫 **`POST /workflows/templates/:id/run`**；圖生圖時建議 body 帶 **`referenceImagePngBase64`**（與規劃時同一張參考圖即可）。

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/images/creative-loop/chat` | 單次 JSON：讀模板白名單、附本機 checkpoint 與 **`object_info` 摘要**，Ollama **`format: json`** 產 **`replyZh`**、**`proposedPatch`**、**`resolvedWorkflow`**／**`patchApply`**。 |
| `POST` | `/images/creative-loop/resource-check` | **第二段**：依對話與 **`proposedPatch`** 產出資源 **checklist**（繁中 + **`browseUrl`** 連至 Civitai 搜尋）；**`hasLocal`** 僅對 **`kind: checkpoint`** 且 **`filename`** 與本機 Comfy checkpoint 清單**完全相符**時為 `true`；**LoRA／VAE** 本階段無本機檔案清單比對，**一律 `hasLocal: false`**（見回傳 **`noteZh`**）。 |

### `POST /images/creative-loop/chat`

**Body：**

- `messages`（必填）：`{ role: "user" \| "assistant", content: string }[]`；最後一則須為 **`user`**；**每一則 `content` 皆須為非空字串**（**不可**僅靠附圖送空文字）。
- `selectedTemplateId`（選填）：小寫 id；有傳則**覆寫**自動選擇；未知模板 **404**。
- `ollamaModel`（選填）：未傳則使用 `OLLAMA_SUMMARY_MODEL`。
- `imageBase64`、`imageBase64s`：與 **Checkpoint 需求助手**相同（合併、每張 8 MB、最多 6 張）。
- `lastOutputPngBase64`（選填）：附於參考圖之後送 Ollama；已滿 6 張參考圖時不可再附 **400**。
- 多圖是否皆被視覺模型利用，**依 Ollama 模型與版本而定**。

**成功 JSON：** `ok: true` 外加 `ollamaModel`、**`selectedTemplateId`**（實際使用之模板）、**`runMode`**（`txt2img` \| `img2img`）、**`templateRouteZh`**（繁中短語）、**`warnings`**（字串陣列）、`templateTitleZh`、`localCheckpoints`、`templates`、`objectInfoSummary`、**`attachedImageCount`**、`assistant`、`resolvedWorkflow`、`patchApply`。

### `POST /images/creative-loop/resource-check`

**Body：**

- `messages`（必填）：格式同 chat；**最後一則須為 `user`**（前端應在規劃後附上「請盤點資源」類使用者句）。
- `resolvedTemplateId`（必填）：須與上一輪 chat 回傳之 **`selectedTemplateId`** 一致（已存在模板）。
- `proposedPatch`（必填）：物件，通常為上一輪 **`assistant.proposedPatch`**。
- `ollamaModel`（選填）。

**成功 JSON：** `ok: true`、`ollamaModel`、`resolvedTemplateId`、**`replyZh`**（繁中簡介）、**`checklist`**（陣列，每筆含 **`id`**（UUID）、**`kind`**（`checkpoint` \| `lora` \| `vae` \| `other`）、**`titleZh`**、**`filename`**（可 `null`）、**`modelTags`**、**`searchQueries`**、**`detailZh`**、**`hasLocal`**、**`browseUrl`**）、`localCheckpoints`、`noteZh`（繁中說明 LoRA/VAE 比對限制）。

---

## 角色庫（本機索引 + 參考圖檔）

用於建立「同一人物」的參考圖集合：**第一張成功入庫的圖為錨點**（`images[0]`），之後加圖會與錨點做身分延續審查。資料為伺服器工作目錄下 **索引 JSON**（預設 `data/character-library/index.json`）與 **圖檔目錄**（預設 `data/character-library/files/`）。另提供 **文生圖試作**：將角色庫內之 **`summaryZh`／`profileEn`** 與使用者 **`prompt`** 合併後，走內建模板 **`basic-txt2img`** 送本機 **ComfyUI** 執行（需 Comfy 可連線且已安裝對應 checkpoint）。

**Ollama：** gate 與 profile 皆呼叫本機 **`/api/generate`**（`format: json`）；請使用支援**視覺**的模型（與摳圖／Checkpoint 助手相同慣例）。`ollamaModel` 省略時使用 `OLLAMA_SUMMARY_MODEL`。

**圖檔：** `imageBase64` 規則與摳圖 API 相同（可含 data URL 前綴、解碼後上限 **8 MB**、PNG／JPEG／WebP）。

### Gate（僅審查、不寫庫）

| 方法 | 路徑 | 用途 |
|------|------|------|
| `POST` | `/characters/gates/anchor` | 單張是否適合作為**錨點**（第一張）。成功時 **200**、`ok: true`、`accepted`、`messageZh`、`ollamaModel`、`machine`（`faceVisible`、`qualityOk`、`qualityScore`、`issuesEn`）。Body：`imageBase64`（必填）、`ollamaModel`（選填）。 |
| `POST` | `/characters/gates/identity` | **錨點**與**候選**是否為同一人且差距可接受。成功時 **200**、`ok: true`、`accepted`、`messageZh`、`ollamaModel`、`machine`（`samePersonLikely`、`gapTooLarge`、`reasonsEn`）。Body：`anchorImageBase64`、`candidateImageBase64`（皆必填）、`ollamaModel`（選填）。 |

### CRUD 與圖檔讀取

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET` | `/characters` | 列表：`characters[]`（`id`、`displayName`、`imageCount`、`updatedAt`、`summaryZh`）、`count`、`storePath`、`filesDir`。 |
| `POST` | `/characters` | 建立角色：`imageBase64`（錨點，必填）、`displayName`（選填字串）、`ollamaModel`（選填）。錨點 gate 未通過時 **422**，`ok: false`、`message`，並可含 `gate`、`machine`、`ollamaModel`。成功時 `character` 見下「詳情形狀」。 |
| `GET` | `/characters/:id` | 詳情；未知 id **404**。 |
| `POST` | `/characters/:id/images` | 加一張參考圖：`imageBase64`（必填）、`ollamaModel`（選填）。身分 gate 未通過時 **422**（欄位同上）。 |
| `POST` | `/characters/:id/profile/refresh` | 依目前最多 **6** 張參考圖（由錨點起算）請 Ollama 產出 **`profileEn`（英文結構化物件）** 與 **`summaryZh`**（繁中摘要）並寫回索引。Body 可為空物件或 `{ "ollamaModel"?: string }`。無圖時 **400**。 |
| `POST` | `/characters/:id/generations/txt2img` | **試作文生圖**：讀取該角色之 `profile`（可為空），將使用者 **`prompt`**（可繁中）與角色摘要合併；預設先以 **Ollama**（`useOllamaExpansion` 未設為 `false` 時）產出**英文**正向提示詞，失敗則改為字串備援；再以模板 **`basic-txt2img`** 送 **ComfyUI** 並回傳 **PNG base64**（無 data URL 前綴）。未知角色 **404**；Comfy／模板錯誤 **502**；參數錯誤 **400**。 |
| `GET` | `/characters/:id/images/:imageId/file` | 回傳已存圖檔 bytes，`Content-Type` 為 `image/jpeg`／`image/png`／`image/webp`。 |

**`POST /characters/:id/generations/txt2img` Body（皆在 JSON 物件內）：**

- `prompt`（必填）：使用者想畫的內容（繁中或英文皆可）。
- `checkpoint`（選填）：Comfy `models/checkpoints` 檔名；省略時使用 **`GET /comfy/checkpoints` 第一筆**（若清單為空則 **502**，請改傳 `checkpoint`）。
- `autoCheckpointByAi`（選填布林）：預設 `true`。為 `true` 且未指定 `checkpoint` 時，會請 Ollama 根據角色資料、提示詞與回饋，從本機 checkpoint 清單挑選；挑選失敗才退回第一筆。
- `negative`（選填）：負向提示；省略時使用伺服器預設英文負向句。
- `steps`（選填，整數）、`cfg`（選填，數字）、`width`／`height`（選填，整數）、`seed`（選填，整數；負值或省略則隨機）。
- `sampler_name`、`scheduler`（選填字串）：對應模板白名單鍵。
- `timeoutMs`（選填）：同 **`POST /workflows/templates/:id/run`**，**10000–1800000**。
- `useOllamaExpansion`（選填布林）：`false` 時略過 Ollama 擴寫，改以字串備援合併角色欄位與 `prompt`。
- `ollamaModel`（選填）：擴寫用；省略時使用 `OLLAMA_SUMMARY_MODEL`。
- `feedbackZh`（選填字串）：對上一張結果的回饋（繁中）；若提供，AI 會嘗試同時調整 checkpoint 選擇、`prompt` 追加詞與部分參數（在安全範圍內）。
- `previousCheckpointUsed`（選填字串）：上一輪實際用到的 checkpoint（可幫助 AI 在回饋調整時比較前後策略）。
- `identityMode`（選填字串）：`"anchor_img2img"`（預設）或 `"text_only"`。`anchor_img2img` 會把角色第一張錨點圖上傳至 Comfy，走 `LoadImage -> VAEEncode -> KSampler(denoise)`，通常較能維持同一人外觀。
- `denoise`（選填數字）：僅 `anchor_img2img` 生效，範圍建議 `0~1`（伺服器會夾住）。越低越貼近錨點、越高越自由；預設 `0.58`。

**成功 JSON：** `ok: true`、`imagePngBase64`、`positiveFinalEn`、`negativeUsed`、`checkpointUsed`、`checkpointDecisionZh`（本次 checkpoint 來源/理由）、`feedbackApplied`（是否有套用回饋策略）、`ollamaExpansionUsed`、`messageZh`（繁中短說明）、`patchApply`（與 **`POST /workflows/templates/:id/run`** 相同形狀）。

**詳情 `character` 形狀（`GET /characters/:id` 與各 POST 成功時）：**

- `human`：`id`、`displayName`、`summaryZh`、`imageCount`、`createdAt`、`updatedAt`。
- `machine`：`characterId`、`profileEn`（物件或 `null`）、`profileMergedAt`（ISO 或 `null`）、`images[]`（`id`、`addedAt`、`mime`、`filePath`（相對於 API 根之路徑，前端需加 base，例如 Vite `VITE_API_BASE_URL`）、`isAnchor`）。

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
| `CHARACTER_LIBRARY_STORE` | 角色庫索引 JSON 檔絕對或相對路徑（選填）；預設為執行時 `cwd` 下 **`data/character-library/index.json`**。 |
| `CHARACTER_LIBRARY_FILES_DIR` | 角色庫參考圖檔根目錄（選填）；預設為執行時 `cwd` 下 **`data/character-library/files`**。 |

CORS：生產環境可設定 `ALLOWED_ORIGINS`（逗號分隔）。
