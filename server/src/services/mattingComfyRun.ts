import type { MattingClassification } from './mattingClassify.js'
import { buildStaticInputsFromRequired } from './mattingComfyNodeDefaults.js'
import { canWireSimpleImageMatting, firstImageOutputSlot } from './mattingComfyCaps.js'
import type { DecodedMattingImage } from './mattingImageBytes.js'
import { uploadImageToComfyui } from './comfyUploadImage.js'
import { runComfyPromptToFirstPngBuffer } from './comfyPromptExecution.js'

const DEFAULT_COMFY_TIMEOUT_MS = 180_000

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

export async function removeBackgroundViaComfy(params: {
  comfyuiBaseUrl: string
  objectInfo: unknown
  mattingClassType: string
  image: DecodedMattingImage
  classification: MattingClassification
  timeoutMs?: number
}): Promise<Buffer> {
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

  const uploadedName = await uploadImageToComfyui(params.comfyuiBaseUrl, params.image)
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
