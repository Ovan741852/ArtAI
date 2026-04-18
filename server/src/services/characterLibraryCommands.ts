import { randomUUID } from 'node:crypto'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from './civitaiCheckpointSummary.js'
import { readCharacterImageFile, writeCharacterImageFile } from './characterLibraryAssets.js'
import {
  findCharacterById,
  readCharacterLibraryIndex,
  writeCharacterLibraryIndex,
  type CharacterRecord,
} from './characterLibraryStore.js'
import { runAnchorAutoSampling, runIdentityAutoSampling } from './characterSamplingOrchestrator.js'
import { decodeMattingImageBase64 } from './mattingImageBytes.js'
import { evaluateProfileRefresh } from './characterLibraryVisionGates.js'

function nowIso(): string {
  return new Date().toISOString()
}

export async function commandCreateCharacter(params: {
  env: ServerEnv
  displayName: string | null | undefined
  imageBase64: unknown
  ollamaModel?: string
}): Promise<CharacterRecord> {
  const decoded = decodeMattingImageBase64(params.imageBase64)
  const sampling = await runAnchorAutoSampling({
    env: params.env,
    candidateImageBase64NoPrefix: decoded.buffer.toString('base64'),
    ollamaModel: params.ollamaModel,
  })
  if (sampling.record.decision === 'reject') {
    throw new AppHttpError(422, sampling.messageZh, {
      gate: 'anchor',
      machine: sampling.anchorGate.machine,
      ollamaModel: sampling.record.ollamaModel,
      sampling: sampling.record,
    })
  }

  const characterId = randomUUID()
  const imageId = randomUUID()
  const { relPath } = await writeCharacterImageFile({
    env: params.env,
    characterId,
    imageId,
    buffer: decoded.buffer,
    mime: decoded.mime,
  })

  const index = await readCharacterLibraryIndex(params.env)
  const displayName =
    params.displayName == null
      ? null
      : typeof params.displayName === 'string'
        ? params.displayName.trim() || null
        : null

  const t = nowIso()
  const row: CharacterRecord = {
    id: characterId,
    displayName,
    createdAt: t,
    updatedAt: t,
    images: [
      {
        id: imageId,
        relPath,
        mime: decoded.mime,
        addedAt: t,
        sampling: sampling.record,
      },
    ],
    profile: null,
  }

  index.characters.push(row)
  index.updatedAt = t
  await writeCharacterLibraryIndex(params.env, index)
  return row
}

export async function commandAddCharacterImage(params: {
  env: ServerEnv
  characterId: string
  imageBase64: unknown
  ollamaModel?: string
}): Promise<CharacterRecord> {
  const index = await readCharacterLibraryIndex(params.env)
  const existing = findCharacterById(index, params.characterId)
  if (!existing) {
    throw new AppHttpError(404, 'Character not found')
  }
  if (existing.images.length === 0) {
    throw new AppHttpError(500, 'Character has no anchor image')
  }

  const anchor = existing.images[0]
  const anchorFile = await readCharacterImageFile(params.env, anchor.relPath)

  const decoded = decodeMattingImageBase64(params.imageBase64)
  const sampling = await runIdentityAutoSampling({
    env: params.env,
    anchorImageBase64NoPrefix: anchorFile.buffer.toString('base64'),
    candidateImageBase64NoPrefix: decoded.buffer.toString('base64'),
    ollamaModel: params.ollamaModel,
  })
  if (sampling.record.decision === 'reject') {
    throw new AppHttpError(422, sampling.messageZh, {
      gate: 'identity',
      machine: sampling.identityGate?.machine ?? sampling.anchorGate.machine,
      ollamaModel: sampling.record.ollamaModel,
      sampling: sampling.record,
    })
  }

  const imageId = randomUUID()
  const { relPath } = await writeCharacterImageFile({
    env: params.env,
    characterId: params.characterId,
    imageId,
    buffer: decoded.buffer,
    mime: decoded.mime,
  })

  const t = nowIso()
  existing.images.push({
    id: imageId,
    relPath,
    mime: decoded.mime,
    addedAt: t,
    sampling: sampling.record,
  })
  existing.updatedAt = t
  index.updatedAt = t
  await writeCharacterLibraryIndex(params.env, index)
  return existing
}

export async function commandRefreshCharacterProfile(params: {
  env: ServerEnv
  characterId: string
  ollamaModel?: string
}): Promise<CharacterRecord> {
  const index = await readCharacterLibraryIndex(params.env)
  const existing = findCharacterById(index, params.characterId)
  if (!existing) {
    throw new AppHttpError(404, 'Character not found')
  }
  const max = 6
  const slice = existing.images.slice(0, max)
  const bases: string[] = []
  for (const im of slice) {
    const f = await readCharacterImageFile(params.env, im.relPath)
    bases.push(f.buffer.toString('base64'))
  }

  const merged = await evaluateProfileRefresh({
    env: params.env,
    imagesBase64NoPrefix: bases,
    ollamaModel: params.ollamaModel,
  })

  const t = nowIso()
  existing.profile = {
    profileEn: merged.profileEn,
    summaryZh: merged.summaryZh,
    mergedAt: t,
  }
  existing.updatedAt = t
  index.updatedAt = t
  await writeCharacterLibraryIndex(params.env, index)
  return existing
}
