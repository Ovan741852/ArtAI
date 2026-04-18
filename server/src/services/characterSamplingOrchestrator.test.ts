import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeCharacterIdentityScore,
  decideCharacterSampling,
  type CharacterSamplingFeatureWeights,
  type CharacterSamplingSignals,
} from './characterSamplingOrchestrator.js'

test('decideCharacterSampling respects thresholds', () => {
  assert.equal(decideCharacterSampling(0.95), 'accept')
  assert.equal(decideCharacterSampling(0.78), 'accept')
  assert.equal(decideCharacterSampling(0.7), 'low_confidence')
  assert.equal(decideCharacterSampling(0.65), 'low_confidence')
  assert.equal(decideCharacterSampling(0.64), 'reject')
})

test('computeCharacterIdentityScore applies weighted score', () => {
  const w: CharacterSamplingFeatureWeights = {
    face: 0.45,
    facialFeatures: 0.3,
    globalMatted: 0.15,
    globalOriginal: 0.1,
  }
  const s: CharacterSamplingSignals = {
    faceScore: 0.8,
    facialFeatureScore: 0.75,
    globalMattedScore: 0.9,
    globalOriginalScore: 0.7,
  }
  assert.equal(computeCharacterIdentityScore(w, s), 0.79)
})

test('computeCharacterIdentityScore clamps invalid numbers', () => {
  const w: CharacterSamplingFeatureWeights = {
    face: 0.45,
    facialFeatures: 0.3,
    globalMatted: 0.15,
    globalOriginal: 0.1,
  }
  const s: CharacterSamplingSignals = {
    faceScore: 3,
    facialFeatureScore: -1,
    globalMattedScore: Number.NaN,
    globalOriginalScore: Number.POSITIVE_INFINITY,
  }
  assert.equal(computeCharacterIdentityScore(w, s), 0.45)
})
