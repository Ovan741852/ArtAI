import type { ServerEnv } from '../config/env.js'
import { classifyMattingImage } from './mattingClassify.js'
import {
  evaluateAnchorPortraitGate,
  evaluateIdentityContinuationGate,
  type AnchorGateMachine,
  type IdentityGateMachine,
} from './characterLibraryVisionGates.js'

const ACCEPT_THRESHOLD = 0.78
const LOW_CONFIDENCE_THRESHOLD = 0.65

export type CharacterSamplingDecision = 'accept' | 'low_confidence' | 'reject'

export type CharacterSamplingFeatureWeights = {
  face: number
  facialFeatures: number
  globalMatted: number
  globalOriginal: number
}

export type CharacterSamplingSignals = {
  faceScore: number
  facialFeatureScore: number
  globalMattedScore: number
  globalOriginalScore: number
}

export type CharacterSamplingRecord = {
  version: 1
  computedAt: string
  ollamaModel: string
  decision: CharacterSamplingDecision
  identityScore: number
  isHuman: boolean
  mattingAttempted: boolean
  mattingUsed: boolean
  mattingFallbackUsed: boolean
  reasonsEn: string[]
  featureWeights: CharacterSamplingFeatureWeights
  featureSignals: CharacterSamplingSignals
}

export type CharacterSamplingResult = {
  record: CharacterSamplingRecord
  messageZh: string
  anchorGate: {
    accepted: boolean
    messageZh: string
    machine: AnchorGateMachine
  }
  identityGate:
    | {
        accepted: boolean
        messageZh: string
        machine: IdentityGateMachine
      }
    | null
}

const FEATURE_WEIGHTS: CharacterSamplingFeatureWeights = {
  face: 0.45,
  facialFeatures: 0.3,
  globalMatted: 0.15,
  globalOriginal: 0.1,
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function decideCharacterSampling(score: number): CharacterSamplingDecision {
  if (score >= ACCEPT_THRESHOLD) return 'accept'
  if (score >= LOW_CONFIDENCE_THRESHOLD) return 'low_confidence'
  return 'reject'
}

export function computeCharacterIdentityScore(
  weights: CharacterSamplingFeatureWeights,
  signals: CharacterSamplingSignals,
): number {
  const total =
    clamp01(signals.faceScore) * weights.face +
    clamp01(signals.facialFeatureScore) * weights.facialFeatures +
    clamp01(signals.globalMattedScore) * weights.globalMatted +
    clamp01(signals.globalOriginalScore) * weights.globalOriginal
  return round3(clamp01(total))
}

function decisionMessageZh(decision: CharacterSamplingDecision): string {
  if (decision === 'accept') return '已自動通過人物採樣檢查。'
  if (decision === 'low_confidence') return '已收錄，但人物一致性信心偏低。'
  return '人物採樣檢查未通過，請改用更清楚、同一人的照片。'
}

function reasonsFromAnchor(machine: AnchorGateMachine): string[] {
  const out = [...machine.issuesEn]
  if (!machine.faceVisible) out.push('face_not_visible')
  if (!machine.qualityOk) out.push('quality_not_ok')
  return out.slice(0, 10)
}

function reasonsFromIdentity(machine: IdentityGateMachine): string[] {
  const out = [...machine.reasonsEn]
  if (!machine.samePersonLikely) out.push('same_person_likely=false')
  if (machine.gapTooLarge) out.push('gap_too_large=true')
  return out.slice(0, 10)
}

async function classifyForMatting(params: {
  env: ServerEnv
  imageBase64NoPrefix: string
  ollamaModel?: string
}): Promise<{
  ollamaModel: string
  mattingAttempted: boolean
  mattingUsed: boolean
  mattingFallbackUsed: boolean
  globalMattedScore: number
  reasonsEn: string[]
}> {
  const cls = await classifyMattingImage({
    env: params.env,
    imageBase64NoPrefix: params.imageBase64NoPrefix,
    ollamaModel: params.ollamaModel,
  })
  const isPortrait = cls.classification.primarySubject === 'single_human_portrait'
  const canUseMatting = isPortrait && (cls.classification.edgeDifficulty === 'simple' || cls.classification.edgeDifficulty === 'moderate')
  const globalMattedScore = canUseMatting ? 1 : isPortrait ? 0.75 : 0.55
  return {
    ollamaModel: cls.modelUsed,
    mattingAttempted: true,
    mattingUsed: canUseMatting,
    mattingFallbackUsed: !canUseMatting,
    globalMattedScore,
    reasonsEn: cls.noteEn ? [cls.noteEn] : [],
  }
}

export async function runAnchorAutoSampling(params: {
  env: ServerEnv
  candidateImageBase64NoPrefix: string
  ollamaModel?: string
}): Promise<CharacterSamplingResult> {
  const anchorGate = await evaluateAnchorPortraitGate({
    env: params.env,
    imageBase64NoPrefix: params.candidateImageBase64NoPrefix,
    ollamaModel: params.ollamaModel,
  })
  const matting = await classifyForMatting({
    env: params.env,
    imageBase64NoPrefix: params.candidateImageBase64NoPrefix,
    ollamaModel: params.ollamaModel,
  })

  const quality = clamp01(anchorGate.machine.qualityScore)
  const faceScore = (quality + (anchorGate.machine.faceVisible ? 1 : 0)) / 2
  const facialFeatureScore = quality
  const signals: CharacterSamplingSignals = {
    faceScore,
    facialFeatureScore,
    globalMattedScore: matting.globalMattedScore,
    globalOriginalScore: quality,
  }

  const score = computeCharacterIdentityScore(FEATURE_WEIGHTS, signals)
  const autoDecision = decideCharacterSampling(score)
  const decision: CharacterSamplingDecision = anchorGate.accepted ? autoDecision : 'reject'

  const reasons = [...reasonsFromAnchor(anchorGate.machine), ...matting.reasonsEn]

  return {
    record: {
      version: 1,
      computedAt: new Date().toISOString(),
      ollamaModel: anchorGate.ollamaModel || matting.ollamaModel,
      decision,
      identityScore: score,
      isHuman: anchorGate.machine.faceVisible,
      mattingAttempted: matting.mattingAttempted,
      mattingUsed: matting.mattingUsed,
      mattingFallbackUsed: matting.mattingFallbackUsed,
      reasonsEn: reasons.slice(0, 16),
      featureWeights: FEATURE_WEIGHTS,
      featureSignals: signals,
    },
    messageZh: anchorGate.accepted ? decisionMessageZh(decision) : anchorGate.messageZh,
    anchorGate: {
      accepted: anchorGate.accepted,
      messageZh: anchorGate.messageZh,
      machine: anchorGate.machine,
    },
    identityGate: null,
  }
}

export async function runIdentityAutoSampling(params: {
  env: ServerEnv
  anchorImageBase64NoPrefix: string
  candidateImageBase64NoPrefix: string
  ollamaModel?: string
}): Promise<CharacterSamplingResult> {
  const anchorGate = await evaluateAnchorPortraitGate({
    env: params.env,
    imageBase64NoPrefix: params.candidateImageBase64NoPrefix,
    ollamaModel: params.ollamaModel,
  })
  const identityGate = await evaluateIdentityContinuationGate({
    env: params.env,
    anchorImageBase64NoPrefix: params.anchorImageBase64NoPrefix,
    candidateImageBase64NoPrefix: params.candidateImageBase64NoPrefix,
    ollamaModel: params.ollamaModel,
  })
  const matting = await classifyForMatting({
    env: params.env,
    imageBase64NoPrefix: params.candidateImageBase64NoPrefix,
    ollamaModel: params.ollamaModel,
  })

  const quality = clamp01(anchorGate.machine.qualityScore)
  const samePersonScore = identityGate.machine.samePersonLikely ? 0.94 : 0.25
  const gapPenalty = identityGate.machine.gapTooLarge ? 0.45 : 1
  const facialFeatureScore = clamp01(samePersonScore * gapPenalty)
  const faceScore = (quality + (anchorGate.machine.faceVisible ? 1 : 0)) / 2
  const signals: CharacterSamplingSignals = {
    faceScore,
    facialFeatureScore,
    globalMattedScore: matting.globalMattedScore,
    globalOriginalScore: quality,
  }

  const score = computeCharacterIdentityScore(FEATURE_WEIGHTS, signals)
  const autoDecision = decideCharacterSampling(score)
  const decision: CharacterSamplingDecision =
    anchorGate.accepted && identityGate.accepted ? autoDecision : 'reject'

  const reasons = [...reasonsFromAnchor(anchorGate.machine), ...reasonsFromIdentity(identityGate.machine), ...matting.reasonsEn]

  return {
    record: {
      version: 1,
      computedAt: new Date().toISOString(),
      ollamaModel: identityGate.ollamaModel || anchorGate.ollamaModel || matting.ollamaModel,
      decision,
      identityScore: score,
      isHuman: anchorGate.machine.faceVisible,
      mattingAttempted: matting.mattingAttempted,
      mattingUsed: matting.mattingUsed,
      mattingFallbackUsed: matting.mattingFallbackUsed,
      reasonsEn: reasons.slice(0, 16),
      featureWeights: FEATURE_WEIGHTS,
      featureSignals: signals,
    },
    messageZh: anchorGate.accepted && identityGate.accepted ? decisionMessageZh(decision) : identityGate.messageZh,
    anchorGate: {
      accepted: anchorGate.accepted,
      messageZh: anchorGate.messageZh,
      machine: anchorGate.machine,
    },
    identityGate: {
      accepted: identityGate.accepted,
      messageZh: identityGate.messageZh,
      machine: identityGate.machine,
    },
  }
}
