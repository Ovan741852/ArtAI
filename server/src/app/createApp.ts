import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { ServerEnv } from '../config/env.js'
import { corsOriginResolver } from '../config/cors.js'
import { systemRoutes } from '../routes/system.js'
import { demoEchoRoutes } from '../routes/demoEcho.js'
import { createComfyCheckpointRoutes } from '../routes/comfyCheckpoints.js'
import { createOllamaModelRoutes } from '../routes/ollamaModels.js'
import { createCivitaiCheckpointSummaryRoutes } from '../routes/civitaiCheckpointSummary.js'
import { createCivitaiModelsSearchRoutes } from '../routes/civitaiModelsSearch.js'
import { createCatalogCheckpointRoutes } from '../routes/catalogCheckpoints.js'

export function createApp(env: ServerEnv): Hono {
  const app = new Hono()
  const resolveOrigin = corsOriginResolver(env)

  app.use('*', logger())
  app.use(
    '*',
    cors({
      origin: resolveOrigin,
    }),
  )

  app.route('/', systemRoutes)
  app.route('/', demoEchoRoutes)
  app.route('/', createComfyCheckpointRoutes(env))
  app.route('/', createOllamaModelRoutes(env))
  app.route('/', createCivitaiCheckpointSummaryRoutes(env))
  app.route('/', createCivitaiModelsSearchRoutes(env))
  app.route('/', createCatalogCheckpointRoutes(env))

  return app
}
