import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export type WhitelistParamSpec = {
  nodeId: string
  inputKey: string
  type: 'int' | 'float' | 'string'
  min?: number
  max?: number
  /** 給模型／工具讀的簡短英文說明（選填）。 */
  descriptionEn?: string
}

export type WorkflowTemplateDoc = {
  id: string
  titleZh: string
  descriptionZh: string
  tags: string[]
  requiredPacks: string[]
  whitelistParams: Record<string, WhitelistParamSpec>
  /** ComfyUI API `prompt` 形狀：節點 id 字串 -> { class_type, inputs } */
  workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>
}

export type WorkflowTemplateListItem = {
  id: string
  titleZh: string
  descriptionZh: string
  tags: string[]
  requiredPacks: string[]
  whitelistKeys: string[]
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function directoryHasWorkflowJson(dir: string): boolean {
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true })
    return names.some((d) => d.isFile() && d.name.endsWith('.json'))
  } catch {
    return false
  }
}

/** 內建模板 bundle 以 `basic-txt2img.json` 為錨點（避免 cwd 下另有零散 json 卻不含 img2img 時誤用該目錄）。 */
function dirHasBuiltinTxt2img(dir: string): boolean {
  try {
    fs.accessSync(path.join(dir, 'basic-txt2img.json'))
    return true
  } catch {
    return false
  }
}

/**
 * 未設 `WORKFLOW_TEMPLATES_DIR` 時：依序找 `cwd/data/workflow-templates`、`cwd/../data/workflow-templates`；
 * **優先**含 `basic-txt2img.json` 者；否則再退回「任一有 `.json`」的目錄（舊行為）。
 */
export function resolveWorkflowTemplatesDir(): string {
  const raw = process.env.WORKFLOW_TEMPLATES_DIR?.trim()
  if (raw && raw !== '') {
    return path.resolve(raw)
  }
  const cwd = process.cwd()
  const underCwd = path.resolve(cwd, 'data', 'workflow-templates')
  const underParent = path.resolve(cwd, '..', 'data', 'workflow-templates')
  if (dirHasBuiltinTxt2img(underCwd)) {
    return underCwd
  }
  if (dirHasBuiltinTxt2img(underParent)) {
    return underParent
  }
  if (directoryHasWorkflowJson(underCwd)) {
    return underCwd
  }
  if (directoryHasWorkflowJson(underParent)) {
    return underParent
  }
  return underCwd
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x)
}

function readWhitelistParamSpec(key: string, raw: unknown): WhitelistParamSpec {
  if (!isPlainObject(raw)) {
    throw new Error(`whitelistParams["${key}"]: expected an object`)
  }
  const nodeId = raw.nodeId
  const inputKey = raw.inputKey
  const type = raw.type
  if (typeof nodeId !== 'string' || !nodeId.trim()) {
    throw new Error(`whitelistParams["${key}"].nodeId must be a non-empty string`)
  }
  if (typeof inputKey !== 'string' || !inputKey.trim()) {
    throw new Error(`whitelistParams["${key}"].inputKey must be a non-empty string`)
  }
  if (type !== 'int' && type !== 'float' && type !== 'string') {
    throw new Error(`whitelistParams["${key}"].type must be "int" | "float" | "string"`)
  }
  const min = typeof raw.min === 'number' ? raw.min : undefined
  const max = typeof raw.max === 'number' ? raw.max : undefined
  const descriptionEn = typeof raw.descriptionEn === 'string' ? raw.descriptionEn : undefined
  return {
    nodeId: nodeId.trim(),
    inputKey: inputKey.trim(),
    type,
    min,
    max,
    descriptionEn,
  }
}

export function parseWorkflowTemplateDoc(raw: unknown, sourceLabel: string): WorkflowTemplateDoc {
  if (!isPlainObject(raw)) {
    throw new Error(`${sourceLabel}: root must be a JSON object`)
  }
  const id = raw.id
  const titleZh = raw.titleZh
  const descriptionZh = raw.descriptionZh
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`${sourceLabel}: "id" must match ${ID_RE.source}`)
  }
  if (typeof titleZh !== 'string' || !titleZh.trim()) {
    throw new Error(`${sourceLabel}: "titleZh" must be a non-empty string`)
  }
  if (typeof descriptionZh !== 'string' || !descriptionZh.trim()) {
    throw new Error(`${sourceLabel}: "descriptionZh" must be a non-empty string`)
  }
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)) : []
  const requiredPacks = Array.isArray(raw.requiredPacks) ? raw.requiredPacks.map((t) => String(t)) : []
  const wpRaw = raw.whitelistParams
  if (!isPlainObject(wpRaw)) {
    throw new Error(`${sourceLabel}: "whitelistParams" must be an object`)
  }
  const whitelistParams: Record<string, WhitelistParamSpec> = {}
  for (const [k, v] of Object.entries(wpRaw)) {
    if (!/^[a-z0-9_]{1,48}$/i.test(k)) {
      throw new Error(`${sourceLabel}: invalid whitelist key "${k}"`)
    }
    whitelistParams[k] = readWhitelistParamSpec(k, v)
  }
  const wfRaw = raw.workflow
  if (!isPlainObject(wfRaw)) {
    throw new Error(`${sourceLabel}: "workflow" must be an object`)
  }
  const workflow: WorkflowTemplateDoc['workflow'] = {}
  for (const [nid, node] of Object.entries(wfRaw)) {
    if (!isPlainObject(node)) {
      throw new Error(`${sourceLabel}: workflow["${nid}"] must be an object`)
    }
    const class_type = node.class_type
    const inputs = node.inputs
    if (typeof class_type !== 'string' || !class_type.trim()) {
      throw new Error(`${sourceLabel}: workflow["${nid}"].class_type required`)
    }
    if (!isPlainObject(inputs)) {
      throw new Error(`${sourceLabel}: workflow["${nid}"].inputs must be an object`)
    }
    workflow[nid] = { class_type: class_type.trim(), inputs: { ...inputs } }
  }
  return {
    id,
    titleZh: titleZh.trim(),
    descriptionZh: descriptionZh.trim(),
    tags,
    requiredPacks,
    whitelistParams,
    workflow,
  }
}

async function readTemplateJsonFiles(dir: string): Promise<Array<{ name: string; text: string }>> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return []
    }
    throw e
  }
  const jsonFiles = names.filter((n) => n.endsWith('.json')).sort()
  const out: Array<{ name: string; text: string }> = []
  for (const name of jsonFiles) {
    const p = path.join(dir, name)
    const text = await fsp.readFile(p, 'utf8')
    out.push({ name, text })
  }
  return out
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplateListItem[]> {
  const dir = resolveWorkflowTemplatesDir()
  const files = await readTemplateJsonFiles(dir)
  const items: WorkflowTemplateListItem[] = []
  for (const { name, text } of files) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      throw new Error(`Invalid JSON in workflow template file "${name}"`)
    }
    const doc = parseWorkflowTemplateDoc(parsed, name)
    items.push({
      id: doc.id,
      titleZh: doc.titleZh,
      descriptionZh: doc.descriptionZh,
      tags: doc.tags,
      requiredPacks: doc.requiredPacks,
      whitelistKeys: Object.keys(doc.whitelistParams).sort(),
    })
  }
  items.sort((a, b) => a.id.localeCompare(b.id))
  return items
}

export async function getWorkflowTemplateById(id: string): Promise<WorkflowTemplateDoc | null> {
  if (!ID_RE.test(id)) {
    return null
  }
  const dir = resolveWorkflowTemplatesDir()
  const filePath = path.join(dir, `${id}.json`)
  let text: string
  try {
    text = await fsp.readFile(filePath, 'utf8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return null
    }
    throw e
  }
  const parsed = JSON.parse(text) as unknown
  const doc = parseWorkflowTemplateDoc(parsed, `${id}.json`)
  if (doc.id !== id) {
    throw new Error(`Template file "${id}.json" has mismatched "id" field (expected "${id}")`)
  }
  return doc
}
