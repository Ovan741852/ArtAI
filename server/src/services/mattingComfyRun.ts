import type { MattingClassification } from './mattingClassify.js'
import { buildStaticInputsFromRequired } from './mattingComfyNodeDefaults.js'
import { canWireSimpleImageMatting, firstImageOutputSlot } from './mattingComfyCaps.js'
import type { DecodedMattingImage } from './mattingImageBytes.js'
import { runComfyPromptToFirstPngBuffer } from './comfyPromptExecution.js'

const DEFAULT_COMFY_TIMEOUT_MS = 180_000

function comfyBase(comfyuiBaseUrl: string): string {
  return comfyuiBaseUrl.replace(/\/+$/, '')
}

function getRequiredMapFromNodeDef(nodeDef: unknown): Record<string, unknown> {
  if (nodeDef == null || typeof nodeDef !== 'object') return {}
  const input = (nodeDef as Record<string, unknown>).input
  if (input == null || typeof input !== 'object') return {}
  const req = (input as Record<string, unknown>).required
  if (req == null || typeof req !== 'object') return {}
  return req as Record<string, unknown>
}

function getOptionalMapFromNodeDef(nodeDef: unknown): Record<string, unknown> {
  if (nodeDef == null || typeof nodeDef !== 'object') return {}
  const input = (nodeDef as Record<string, unknown>).input
  if (input == null || typeof input !== 'object') return {}
  const opt = (input as Record<string, unknown>).optional
  if (opt == null || typeof opt !== 'object') return {}
  return opt as Record<string, unknown>
}

function findImageInputKey(required: Record<string, unknown>): string | null {
  for (const [k, spec] of Object.entries(required)) {
    if (Array.isArray(spec) && spec[0] === 'IMAGE') return k
  }
  return null
}

async function comfyUploadImage(base: string, image: DecodedMattingImage): Promise<string> {
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

export async function removeBackgroundViaComfy(params: {
  comfyuiBaseUrl: string
  objectInfo: unknown
  mattingClassType: string
  image: DecodedMattingImage
  classification: MattingClassification
  timeoutMs?: number
}): Promise<Buffer> {
  const base = comfyBase(params.comfyuiBaseUrl)
  const timeoutMs = params.timeoutMs ?? DEFAULT_COMFY_TIMEOUT_MS

  if (params.objectInfo == null || typeof params.objectInfo !== 'object') {
    throw new Error('object_info missing')
  }
  const nodeDef = (params.objectInfo as Record<string, unknown>)[params.mattingClassType]
  if (!canWireSimpleImageMatting(nodeDef)) {
    throw new Error(`Node "${params.mattingClassType}" is not compatible with simple LoadImage wiring`)
  }

  const required = getRequiredMapFromNodeDef(nodeDef)
  const imageKey = findImageInputKey(required)
  if (!imageKey) {
    throw new Error(`Node "${params.mattingClassType}" has no IMAGE input`)
  }

  const uploadedName = await comfyUploadImage(base, params.image)
  const optionalMat = getOptionalMapFromNodeDef(nodeDef)
  const staticInputs = {
    ...buildStaticInputsFromRequired(optionalMat as Record<string, unknown>, params.classification),
    ...buildStaticInputsFromRequired(required as Record<string, unknown>, params.classification),
  }

  const saveDef =
    params.objectInfo != null && typeof params.objectInfo === 'object'
      ? (params.objectInfo as Record<string, unknown>)['SaveImage']
      : undefined
  const saveRequired = getRequiredMapFromNodeDef(saveDef)
  const saveOptional = getOptionalMapFromNodeDef(saveDef)
  const saveStatic = {
    ...buildStaticInputsFromRequired(saveOptional as Record<string, unknown>, params.classification),
    ...buildStaticInputsFromRequired(saveRequired as Record<string, unknown>, params.classification),
  }
  delete saveStatic.images
  delete saveStatic.filename_prefix

  const loadId = '1'
  const matId = '2'
  const saveId = '3'
  const outSlot = firstImageOutputSlot(nodeDef)

  const prompt: Record<string, unknown> = {
    [loadId]: {
      class_type: 'LoadImage',
      inputs: { image: uploadedName },
    },
    [matId]: {
      class_type: params.mattingClassType,
      inputs: {
        ...staticInputs,
        [imageKey]: [loadId, 0],
      },
    },
    [saveId]: {
      class_type: 'SaveImage',
      inputs: {
        ...saveStatic,
        filename_prefix: 'artai_matting',
        images: [matId, outSlot],
      },
    },
  }

  return await runComfyPromptToFirstPngBuffer({
    comfyuiBaseUrl: params.comfyuiBaseUrl,
    prompt,
    timeoutMs,
  })
}
