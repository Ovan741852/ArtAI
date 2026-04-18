import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { ollamaGenerateNonStream } from './ollamaGenerate.js'
import {
  ANCHOR_GATE_JSON_INSTRUCTION,
  IDENTITY_GATE_JSON_INSTRUCTION,
  PROFILE_REFRESH_JSON_INSTRUCTION,
} from './characterLibraryVisionPrompts.js'

function pickModel(env: ServerEnv, ollamaModel?: string): string {
  const m = ollamaModel?.trim()
  return m && m !== '' ? m : env.ollamaSummaryModel
}

function parseJsonObjectFromModel(raw: string, context: string): Record<string, unknown> {
  const t = raw.trim()
  if (!t) {
    throw new AppHttpError(502, `${context}: empty model response`)
  }
  let data: unknown
  try {
    data = JSON.parse(t) as unknown
  } catch {
    throw new AppHttpError(502, `${context}: model response is not valid JSON`)
  }
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppHttpError(502, `${context}: model JSON must be an object`)
  }
  return data as Record<string, unknown>
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

function asNum01(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(1, Math.max(0, v))
}

export type AnchorGateMachine = {
  faceVisible: boolean
  qualityOk: boolean
  qualityScore: number
  issuesEn: string[]
}

export type AnchorGateResult = {
  ollamaModel: string
  accepted: boolean
  messageZh: string
  machine: AnchorGateMachine
}

export async function evaluateAnchorPortraitGate(params: {
  env: ServerEnv
  imageBase64NoPrefix: string
  ollamaModel?: string
}): Promise<AnchorGateResult> {
  const model = pickModel(params.env, params.ollamaModel)
  let raw: string
  try {
    raw = await ollamaGenerateNonStream({
      ollamaBaseUrl: params.env.ollamaBaseUrl,
      model,
      prompt: ANCHOR_GATE_JSON_INSTRUCTION,
      images: [params.imageBase64NoPrefix],
      format: 'json',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Ollama anchor gate failed: ${msg}`)
  }

  const o = parseJsonObjectFromModel(raw, 'Anchor gate')
  const faceVisible = asBool(o.faceVisible, false)
  const qualityOk = asBool(o.qualityOk, false)
  const qualityScore = asNum01(o.qualityScore, 0)
  const issuesEn = asStrArray(o.issuesEn)
  let accepted = asBool(o.accepted, false)
  const messageZh = asStr(o.messageZh, accepted ? '可作為基準照片。' : '請換一張更清楚、正臉的人像照片。')

  if (accepted && (!faceVisible || !qualityOk || qualityScore < 0.45)) {
    accepted = false
  }

  return {
    ollamaModel: model,
    accepted,
    messageZh,
    machine: {
      faceVisible,
      qualityOk,
      qualityScore,
      issuesEn,
    },
  }
}

export type IdentityGateMachine = {
  samePersonLikely: boolean
  gapTooLarge: boolean
  reasonsEn: string[]
}

export type IdentityGateResult = {
  ollamaModel: string
  accepted: boolean
  messageZh: string
  machine: IdentityGateMachine
}

export async function evaluateIdentityContinuationGate(params: {
  env: ServerEnv
  anchorImageBase64NoPrefix: string
  candidateImageBase64NoPrefix: string
  ollamaModel?: string
}): Promise<IdentityGateResult> {
  const model = pickModel(params.env, params.ollamaModel)
  let raw: string
  try {
    raw = await ollamaGenerateNonStream({
      ollamaBaseUrl: params.env.ollamaBaseUrl,
      model,
      prompt: IDENTITY_GATE_JSON_INSTRUCTION,
      images: [params.anchorImageBase64NoPrefix, params.candidateImageBase64NoPrefix],
      format: 'json',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Ollama identity gate failed: ${msg}`)
  }

  const o = parseJsonObjectFromModel(raw, 'Identity gate')
  const samePersonLikely = asBool(o.samePersonLikely, false)
  const gapTooLarge = asBool(o.gapTooLarge, true)
  let accepted = asBool(o.accepted, false)
  const messageZh = asStr(o.messageZh, accepted ? '可加入角色庫。' : '與基準照片差異過大或非同一人，請換一張同一人的照片。')
  const reasonsEn = asStrArray(o.reasonsEn)

  if (accepted && (!samePersonLikely || gapTooLarge)) {
    accepted = false
  }

  return {
    ollamaModel: model,
    accepted,
    messageZh,
    machine: {
      samePersonLikely,
      gapTooLarge,
      reasonsEn,
    },
  }
}

export type ProfileRefreshResult = {
  ollamaModel: string
  profileEn: Record<string, unknown>
  summaryZh: string
}

export async function evaluateProfileRefresh(params: {
  env: ServerEnv
  imagesBase64NoPrefix: string[]
  ollamaModel?: string
}): Promise<ProfileRefreshResult> {
  const imgs = params.imagesBase64NoPrefix.filter((s) => s.trim() !== '')
  if (imgs.length === 0) {
    throw new AppHttpError(400, 'No images for profile refresh')
  }
  const model = pickModel(params.env, params.ollamaModel)
  let raw: string
  try {
    raw = await ollamaGenerateNonStream({
      ollamaBaseUrl: params.env.ollamaBaseUrl,
      model,
      prompt: PROFILE_REFRESH_JSON_INSTRUCTION,
      images: imgs,
      format: 'json',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppHttpError(502, `Ollama profile refresh failed: ${msg}`)
  }

  const o = parseJsonObjectFromModel(raw, 'Profile refresh')
  const profileRaw = o.profileEn
  const profileEn =
    profileRaw != null && typeof profileRaw === 'object' && !Array.isArray(profileRaw)
      ? (profileRaw as Record<string, unknown>)
      : {}
  const summaryZh = asStr(o.summaryZh, '')

  return {
    ollamaModel: model,
    profileEn,
    summaryZh: summaryZh.trim() || '（無摘要）',
  }
}
