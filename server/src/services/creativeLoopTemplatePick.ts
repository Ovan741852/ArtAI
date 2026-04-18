import { AppHttpError } from './civitaiCheckpointSummary.js'
import { parseOllamaVisionImagesFromBody } from './ollamaVisionImagesFromBody.js'
import { listWorkflowTemplates } from './workflowTemplatesRegistry.js'

/** 僅計使用者參考圖（不含 lastOutputPngBase64）。 */
export function countUserReferenceImages(body: Record<string, unknown>): number {
  const { imagesBase64 } = parseOllamaVisionImagesFromBody(body)
  return imagesBase64.length
}

export type CreativeLoopTemplatePick = {
  selectedTemplateId: string
  runMode: 'txt2img' | 'img2img'
  templateRouteZh: string
  warnings: string[]
}

/**
 * 有參考圖且存在 `basic-img2img` 模板 → 圖生圖；否則文生圖（必要時附警告）。
 */
export async function resolveCreativeLoopTemplate(body: Record<string, unknown>): Promise<CreativeLoopTemplatePick> {
  const refCount = countUserReferenceImages(body)
  const templates = await listWorkflowTemplates()
  const ids = new Set(templates.map((t) => t.id))
  const warnings: string[] = []

  if (refCount > 0 && ids.has('basic-img2img')) {
    return {
      selectedTemplateId: 'basic-img2img',
      runMode: 'img2img',
      templateRouteZh: '圖生圖（依參考圖）',
      warnings,
    }
  }

  if (refCount > 0 && !ids.has('basic-img2img')) {
    warnings.push('伺服器未提供 basic-img2img 模板，已改為文生圖；參考圖仍會送給 AI 閱讀。')
  }

  if (!ids.has('basic-txt2img')) {
    throw new AppHttpError(502, 'Server is missing required workflow template: basic-txt2img')
  }

  return {
    selectedTemplateId: 'basic-txt2img',
    runMode: 'txt2img',
    templateRouteZh: '文生圖',
    warnings,
  }
}
