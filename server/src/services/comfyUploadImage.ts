import type { DecodedMattingImage } from './mattingImageBytes.js'

function comfyBase(comfyuiBaseUrl: string): string {
  return comfyuiBaseUrl.replace(/\/+$/, '')
}

/**
 * 上傳圖至 ComfyUI `POST /upload/image`，回傳 Comfy 內部檔名（寫入 LoadImage）。
 */
export async function uploadImageToComfyui(
  comfyuiBaseUrl: string,
  image: DecodedMattingImage,
): Promise<string> {
  const base = comfyBase(comfyuiBaseUrl)
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename)
  form.append('type', 'input')
  form.append('overwrite', 'true')

  const res = await fetch(`${base}/upload/image`, {
    method: 'POST',
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    const snippet = text.length > 240 ? `${text.slice(0, 240)}…` : text
    throw new Error(`ComfyUI upload ${String(res.status)}: ${snippet || res.statusText}`)
  }
  let data: unknown
  try {
    data = JSON.parse(text) as unknown
  } catch {
    throw new Error('ComfyUI /upload/image: response is not JSON')
  }
  if (data == null || typeof data !== 'object') {
    throw new Error('ComfyUI /upload/image: expected JSON object')
  }
  const name = (data as Record<string, unknown>).name
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('ComfyUI /upload/image: missing "name"')
  }
  return name.trim()
}

type WorkflowNode = { class_type: string; inputs: Record<string, unknown> }

/**
 * 將第一個 `LoadImage` 節點的 `inputs.image` 設為上傳檔名。
 */
export function setFirstLoadImageFilename(
  workflow: Record<string, WorkflowNode>,
  uploadedName: string,
): void {
  for (const node of Object.values(workflow)) {
    if (node.class_type === 'LoadImage' && node.inputs && typeof node.inputs === 'object') {
      node.inputs.image = uploadedName
      return
    }
  }
  throw new Error('Workflow has no LoadImage node for reference image')
}

export function workflowHasLoadImage(workflow: Record<string, WorkflowNode>): boolean {
  return Object.values(workflow).some((n) => n.class_type === 'LoadImage')
}
