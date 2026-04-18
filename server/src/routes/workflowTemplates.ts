import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import { runWorkflowTemplateOnComfy } from '../services/workflowTemplateRun.js'
import { getWorkflowTemplateById, listWorkflowTemplates } from '../services/workflowTemplatesRegistry.js'

export function createWorkflowTemplateRoutes(env: ServerEnv) {
  const r = new Hono()

  /** 內建 Comfy workflow 模板列表（摘要）。 */
  r.get('/workflows/templates', async (c) => {
    try {
      const templates = await listWorkflowTemplates()
      return c.json({ ok: true, templates })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  /** 單一模板：繁中說明、白名單參數定義、預設 workflow（Comfy `prompt` 形狀）。 */
  r.get('/workflows/templates/:id', async (c) => {
    const id = c.req.param('id')
    try {
      const doc = await getWorkflowTemplateById(id)
      if (!doc) {
        return c.json({ ok: false, message: `Unknown template: "${id}"` }, 404)
      }
      return c.json({
        ok: true,
        human: {
          id: doc.id,
          titleZh: doc.titleZh,
          descriptionZh: doc.descriptionZh,
          tags: doc.tags,
          requiredPacks: doc.requiredPacks,
        },
        machine: {
          templateId: doc.id,
          whitelistParams: doc.whitelistParams,
          workflow: doc.workflow,
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  /** 套用白名單 patch（可空）並送 Comfy 執行，回傳 PNG base64。 */
  r.post('/workflows/templates/:id/run', async (c) => {
    const id = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      const hint = e instanceof Error && /Unexpected end|JSON/i.test(e.message) ? '（請求 body 是否過大？）' : ''
      return c.json({ ok: false, message: `Invalid JSON body${hint}` }, 400)
    }
    try {
      const result = await runWorkflowTemplateOnComfy(env, id, body)
      return c.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const code = e.status === 400 || e.status === 404 ? e.status : 502
        return c.json({ ok: false, message: e.message }, code)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}
