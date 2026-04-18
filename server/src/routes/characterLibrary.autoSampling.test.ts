import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { Hono } from 'hono'
import type { ServerEnv } from '../config/env.js'
import { createCharacterLibraryRoutes } from './characterLibrary.js'

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Zf5EAAAAASUVORK5CYII='

type MockOllamaHandle = {
  baseUrl: string
  setResponses: (items: Record<string, unknown>[]) => void
  close: () => Promise<void>
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks).toString('utf8')
}

async function createMockOllama(): Promise<MockOllamaHandle> {
  const queue: Record<string, unknown>[] = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/api/generate' || req.method !== 'POST') {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    await readRequestBody(req)
    const next = queue.shift()
    if (!next) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'mock queue empty' }))
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ response: JSON.stringify(next) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('cannot bind mock ollama')
  return {
    baseUrl: `http://127.0.0.1:${String(addr.port)}`,
    setResponses(items: Record<string, unknown>[]) {
      queue.length = 0
      queue.push(...items)
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

async function withTestApp(
  run: (ctx: {
    requestJson: (url: string, method: 'POST' | 'GET', body?: Record<string, unknown>) => Promise<Response>
    mock: MockOllamaHandle
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artai-char-test-'))
  const mock = await createMockOllama()
  const env: ServerEnv = {
    port: 0,
    nodeEnv: 'test',
    allowedOrigins: [],
    comfyuiBaseUrl: 'http://127.0.0.1:1',
    ollamaBaseUrl: mock.baseUrl,
    civitaiBaseUrl: 'https://civitai.com',
    civitaiApiKey: undefined,
    ollamaSummaryModel: 'llava',
    localModelsDumpTtlMs: 0,
    comfyObjectInfoTtlMs: 0,
    characterLibraryStorePath: path.join(dir, 'index.json'),
    characterLibraryFilesDir: path.join(dir, 'files'),
  }
  const app = new Hono()
  app.route('/', createCharacterLibraryRoutes(env))
  const requestJson = async (url: string, method: 'POST' | 'GET', body?: Record<string, unknown>): Promise<Response> =>
    app.request(`http://localhost${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })

  try {
    await run({ requestJson: async (url, method, body) => requestJson(url, method, body), mock })
  } finally {
    await mock.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test('POST /characters rejects non-human anchor with 422', async () => {
  await withTestApp(async ({ requestJson, mock }) => {
    mock.setResponses([
      {
        accepted: false,
        messageZh: '請換一張更清楚、正臉的人像照片。',
        faceVisible: false,
        qualityOk: false,
        qualityScore: 0.22,
        issuesEn: ['not_a_human_face'],
      },
      {
        primarySubject: 'scene_mixed',
        edgeDifficulty: 'hard',
        preferQualityOverSpeed: false,
      },
    ])
    const res = await requestJson('/characters', 'POST', { imageBase64: PNG_1X1_BASE64 })
    assert.equal(res.status, 422)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(body.ok, false)
    assert.equal(body.gate, 'anchor')
    const sampling = body.sampling as Record<string, unknown>
    assert.equal(sampling.decision, 'reject')
  })
})

test('POST /characters accepts and includes sampling metadata', async () => {
  await withTestApp(async ({ requestJson, mock }) => {
    mock.setResponses([
      {
        accepted: true,
        messageZh: '可作為基準照片。',
        faceVisible: true,
        qualityOk: true,
        qualityScore: 0.94,
        issuesEn: [],
      },
      {
        primarySubject: 'single_human_portrait',
        edgeDifficulty: 'simple',
        preferQualityOverSpeed: true,
      },
    ])
    const res = await requestJson('/characters', 'POST', { imageBase64: PNG_1X1_BASE64 })
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(body.ok, true)
    const character = body.character as Record<string, unknown>
    const machine = character.machine as Record<string, unknown>
    const images = machine.images as Array<Record<string, unknown>>
    assert.equal(images.length, 1)
    const sampling = images[0].sampling as Record<string, unknown>
    assert.equal(sampling.decision, 'accept')
    assert.equal(typeof sampling.identityScore, 'number')
  })
})

test('POST /characters/:id/images keeps low confidence image', async () => {
  await withTestApp(async ({ requestJson, mock }) => {
    mock.setResponses([
      {
        accepted: true,
        messageZh: '可作為基準照片。',
        faceVisible: true,
        qualityOk: true,
        qualityScore: 0.95,
        issuesEn: [],
      },
      {
        primarySubject: 'single_human_portrait',
        edgeDifficulty: 'simple',
        preferQualityOverSpeed: true,
      },
    ])
    const createRes = await requestJson('/characters', 'POST', { imageBase64: PNG_1X1_BASE64 })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const charId = (((createBody.character as Record<string, unknown>).human as Record<string, unknown>).id as string) || ''
    assert.ok(charId)

    mock.setResponses([
      {
        accepted: true,
        messageZh: '可作為基準照片。',
        faceVisible: true,
        qualityOk: true,
        qualityScore: 0.5,
        issuesEn: ['slightly_blurry'],
      },
      {
        accepted: true,
        messageZh: '可加入角色庫。',
        samePersonLikely: true,
        gapTooLarge: false,
        reasonsEn: ['facial_shape_match'],
      },
      {
        primarySubject: 'scene_mixed',
        edgeDifficulty: 'hard',
        preferQualityOverSpeed: false,
      },
    ])
    const addRes = await requestJson(`/characters/${encodeURIComponent(charId)}/images`, 'POST', {
      imageBase64: PNG_1X1_BASE64,
    })
    assert.equal(addRes.status, 200)
    const addBody = (await addRes.json()) as Record<string, unknown>
    const machine = ((addBody.character as Record<string, unknown>).machine as Record<string, unknown>) || {}
    const images = (machine.images as Array<Record<string, unknown>>) || []
    const last = images[images.length - 1]
    const sampling = (last.sampling as Record<string, unknown>) || {}
    assert.equal(sampling.decision, 'low_confidence')
  })
})

test('POST /characters/:id/images rejects when identity gate fails', async () => {
  await withTestApp(async ({ requestJson, mock }) => {
    mock.setResponses([
      {
        accepted: true,
        messageZh: '可作為基準照片。',
        faceVisible: true,
        qualityOk: true,
        qualityScore: 0.9,
        issuesEn: [],
      },
      {
        primarySubject: 'single_human_portrait',
        edgeDifficulty: 'simple',
        preferQualityOverSpeed: true,
      },
    ])
    const createRes = await requestJson('/characters', 'POST', { imageBase64: PNG_1X1_BASE64 })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const charId = (((createBody.character as Record<string, unknown>).human as Record<string, unknown>).id as string) || ''
    assert.ok(charId)

    mock.setResponses([
      {
        accepted: true,
        messageZh: '可作為基準照片。',
        faceVisible: true,
        qualityOk: true,
        qualityScore: 0.93,
        issuesEn: [],
      },
      {
        accepted: false,
        messageZh: '與基準照片差異過大或非同一人。',
        samePersonLikely: false,
        gapTooLarge: true,
        reasonsEn: ['different_person'],
      },
      {
        primarySubject: 'single_human_portrait',
        edgeDifficulty: 'simple',
        preferQualityOverSpeed: true,
      },
    ])
    const addRes = await requestJson(`/characters/${encodeURIComponent(charId)}/images`, 'POST', {
      imageBase64: PNG_1X1_BASE64,
    })
    assert.equal(addRes.status, 422)
    const addBody = (await addRes.json()) as Record<string, unknown>
    assert.equal(addBody.gate, 'identity')
    const sampling = addBody.sampling as Record<string, unknown>
    assert.equal(sampling.decision, 'reject')
  })
})
