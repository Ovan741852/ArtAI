import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ServerEnv } from '../config/env.js'
import { AppHttpError } from '../services/civitaiCheckpointSummary.js'
import { readCharacterImageFile } from '../services/characterLibraryAssets.js'
import {
  commandAddCharacterImage,
  commandCreateCharacter,
  commandRefreshCharacterProfile,
} from '../services/characterLibraryCommands.js'
import {
  findCharacterById,
  readCharacterLibraryIndex,
} from '../services/characterLibraryStore.js'
import { decodeMattingImageBase64 } from '../services/mattingImageBytes.js'
import { parseAnchorAndCandidateImages } from '../services/ollamaVisionImagesFromBody.js'
import {
  evaluateAnchorPortraitGate,
  evaluateIdentityContinuationGate,
} from '../services/characterLibraryVisionGates.js'
import { runCharacterTxt2imgFromLibrary } from '../services/characterLibraryTxt2imgGeneration.js'

function filePathForImage(characterId: string, imageId: string): string {
  return `/characters/${characterId}/images/${imageId}/file`
}

export function createCharacterLibraryRoutes(env: ServerEnv) {
  const r = new Hono()

  r.post('/characters/gates/anchor', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }
    const o = body as Record<string, unknown>
    const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : undefined
    try {
      const decoded = decodeMattingImageBase64(o.imageBase64)
      const imageB64 = decoded.buffer.toString('base64')
      const result = await evaluateAnchorPortraitGate({
        env,
        imageBase64NoPrefix: imageB64,
        ollamaModel,
      })
      return c.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const code = e.status === 400 ? 400 : 502
        return c.json({ ok: false, message: e.message }, code)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  r.post('/characters/gates/identity', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }
    const o = body as Record<string, unknown>
    const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : undefined
    try {
      const { anchorImageBase64, candidateImageBase64 } = parseAnchorAndCandidateImages(o)
      const result = await evaluateIdentityContinuationGate({
        env,
        anchorImageBase64NoPrefix: anchorImageBase64,
        candidateImageBase64NoPrefix: candidateImageBase64,
        ollamaModel,
      })
      return c.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const code = e.status === 400 ? 400 : 502
        return c.json({ ok: false, message: e.message }, code)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  r.get('/characters', async (c) => {
    try {
      const index = await readCharacterLibraryIndex(env)
      const items = index.characters.map((ch) => ({
        id: ch.id,
        displayName: ch.displayName,
        imageCount: ch.images.length,
        updatedAt: ch.updatedAt,
        summaryZh: ch.profile?.summaryZh ?? null,
      }))
      return c.json({
        ok: true,
        storePath: env.characterLibraryStorePath,
        filesDir: env.characterLibraryFilesDir,
        count: items.length,
        characters: items,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 500)
    }
  })

  r.post('/characters', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }
    const o = body as Record<string, unknown>
    const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : undefined
    let displayName: string | null = null
    if (Object.prototype.hasOwnProperty.call(o, 'displayName')) {
      const d = o.displayName
      if (d == null) displayName = null
      else if (typeof d === 'string') displayName = d.trim() || null
      else return c.json({ ok: false, message: 'displayName must be a string or null' }, 400)
    }
    try {
      const row = await commandCreateCharacter({
        env,
        displayName,
        imageBase64: o.imageBase64,
        ollamaModel,
      })
      return c.json({
        ok: true,
        character: formatCharacterDetail(row),
      })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const bodyOut: Record<string, unknown> = { ok: false, message: e.message }
        const ex = e.extra
        if (ex != null && typeof ex === 'object') {
          for (const [k, v] of Object.entries(ex)) {
            bodyOut[k] = v
          }
        }
        return c.json(bodyOut, e.status as ContentfulStatusCode)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  r.get('/characters/:id/images/:imageId/file', async (c) => {
    const characterId = c.req.param('id')
    const imageId = c.req.param('imageId')
    try {
      const index = await readCharacterLibraryIndex(env)
      const ch = findCharacterById(index, characterId)
      if (!ch) {
        return c.json({ ok: false, message: 'Character not found' }, 404)
      }
      const im = ch.images.find((x) => x.id === imageId)
      if (!im) {
        return c.json({ ok: false, message: 'Image not found' }, 404)
      }
      const { buffer, mime } = await readCharacterImageFile(env, im.relPath)
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch (e) {
      if (e instanceof AppHttpError) {
        return c.json({ ok: false, message: e.message }, e.status === 404 ? 404 : 502)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  r.get('/characters/:id', async (c) => {
    const characterId = c.req.param('id')
    try {
      const index = await readCharacterLibraryIndex(env)
      const ch = findCharacterById(index, characterId)
      if (!ch) {
        return c.json({ ok: false, message: 'Character not found' }, 404)
      }
      return c.json({ ok: true, character: formatCharacterDetail(ch) })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 500)
    }
  })

  r.post('/characters/:id/images', async (c) => {
    const characterId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }
    const o = body as Record<string, unknown>
    const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : undefined
    try {
      const row = await commandAddCharacterImage({
        env,
        characterId,
        imageBase64: o.imageBase64,
        ollamaModel,
      })
      return c.json({
        ok: true,
        character: formatCharacterDetail(row),
      })
    } catch (e) {
      if (e instanceof AppHttpError) {
        const bodyOut: Record<string, unknown> = { ok: false, message: e.message }
        const ex = e.extra
        if (ex != null && typeof ex === 'object') {
          for (const [k, v] of Object.entries(ex)) {
            bodyOut[k] = v
          }
        }
        return c.json(bodyOut, e.status as ContentfulStatusCode)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  r.post('/characters/:id/generations/txt2img', async (c) => {
    const characterId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, message: 'Expected a JSON object body' }, 400)
    }
    try {
      const out = await runCharacterTxt2imgFromLibrary({
        env,
        characterId,
        body,
      })
      return c.json({ ok: true, ...out })
    } catch (e) {
      if (e instanceof AppHttpError) {
        return c.json({ ok: false, message: e.message }, e.status as ContentfulStatusCode)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  r.post('/characters/:id/profile/refresh', async (c) => {
    const characterId = c.req.param('id')
    let body: unknown = {}
    try {
      const txt = await c.req.text()
      if (txt.trim()) body = JSON.parse(txt) as unknown
    } catch {
      return c.json({ ok: false, message: 'Request body must be JSON' }, 400)
    }
    const o = body != null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const ollamaModel = typeof o.ollamaModel === 'string' ? o.ollamaModel : undefined
    try {
      const row = await commandRefreshCharacterProfile({
        env,
        characterId,
        ollamaModel,
      })
      return c.json({
        ok: true,
        character: formatCharacterDetail(row),
      })
    } catch (e) {
      if (e instanceof AppHttpError) {
        return c.json({ ok: false, message: e.message }, e.status as ContentfulStatusCode)
      }
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, message }, 502)
    }
  })

  return r
}

function formatCharacterDetail(ch: import('../services/characterLibraryStore.js').CharacterRecord) {
  const images = ch.images.map((im) => ({
    id: im.id,
    addedAt: im.addedAt,
    mime: im.mime,
    /** Relative HTTP path; prefix with API base (e.g. Vite `/api`). */
    filePath: filePathForImage(ch.id, im.id),
    isAnchor: ch.images[0]?.id === im.id,
    sampling: im.sampling ?? null,
  }))
  return {
    human: {
      id: ch.id,
      displayName: ch.displayName ?? '',
      summaryZh: ch.profile?.summaryZh ?? null,
      imageCount: ch.images.length,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    },
    machine: {
      characterId: ch.id,
      profileEn: ch.profile?.profileEn ?? null,
      profileMergedAt: ch.profile?.mergedAt ?? null,
      images,
    },
  }
}
