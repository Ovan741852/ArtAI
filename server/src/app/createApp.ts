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
import { createCivitaiCheckpointTagAssistantRoutes } from '../routes/civitaiCheckpointTagAssistant.js'
import { createCivitaiModelBundleAssistantRoutes } from '../routes/civitaiModelBundleAssistant.js'
import { createCatalogCheckpointRoutes } from '../routes/catalogCheckpoints.js'
import { createLocalModelsDumpRoutes } from '../routes/localModelsDump.js'
import { createWorkflowAssistantRoutes } from '../routes/workflowAssistant.js'
import { createWorkflowTemplateRoutes } from '../routes/workflowTemplates.js'
import { createMattingAutoRoutes } from '../routes/mattingAuto.js'

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
  app.route('/', createCivitaiCheckpointTagAssistantRoutes(env))
  app.route('/', createCivitaiModelBundleAssistantRoutes(env))
  app.route('/', createCatalogCheckpointRoutes(env))
  app.route('/', createLocalModelsDumpRoutes(env))
  app.route('/', createWorkflowTemplateRoutes())
  app.route('/', createWorkflowAssistantRoutes(env))
  app.route('/', createMattingAutoRoutes(env))

  return app
}
