import { Hono } from 'hono'
import { getWorkflowTemplateById, listWorkflowTemplates } from '../services/workflowTemplatesRegistry.js'

export function createWorkflowTemplateRoutes() {
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

  return r
}
