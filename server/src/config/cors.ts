import type { ServerEnv } from './env.js'

/**
 * CORS policy kept in one place so routes stay free of cross-cutting concerns.
 */
export function corsOriginResolver(env: ServerEnv): (origin: string) => string | null | undefined {
  if (env.nodeEnv !== 'production') {
    return () => '*'
  }

  const allowed = new Set(env.allowedOrigins)
  if (allowed.size === 0) {
    return () => null
  }

  return (origin) => (origin && allowed.has(origin) ? origin : null)
}
