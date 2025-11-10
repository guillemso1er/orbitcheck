import fastifyAuth, { FastifyAuthFunction } from '@fastify/auth'
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Pool } from 'pg'
import { verifyAPIKey, verifyHMAC, verifyPAT, verifySession } from 'src/services/auth'
import { getDefaultProjectId } from 'src/services/utils'

// Optional: Unify the identity object attached by any auth method
declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      method: 'session' | 'pat' | 'apiKey' | 'hmac'
      userId?: string
      patScopes?: string[]
      projectId?: string
      apiKeyId?: string
    }
  }
}

type SchemeName = 'patAuth' | 'apiKeyAuth' | 'sessionCookie' | 'hmacAuth'

interface Options {
  pool: Pool
  defaultSecurity?: Array<Record<string, string[]>>
  // If you need to override any guard, you can pass them here
  guards?: Partial<Record<SchemeName, FastifyAuthFunction>>
}

export default fp<Options>(async function openapiSecurity(app, opts) {
  app.register(fastifyAuth)

  const { pool } = opts

  // Helper: wrap async checks into auth guards that throw on failure
  const asGuard = (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>): FastifyAuthFunction =>
    async (req, reply) => { await fn(req, reply) } // throw to fail

  // Replace these with your versions that don’t send replies on failure
  async function verifySessionNoReply(req: FastifyRequest) {
    await verifySession(req, pool) // should throw on failure
    req.auth = { ...(req.auth ?? {}), method: 'session', userId: (req as any).user_id }
  }

  async function verifyPatNoReply(req: FastifyRequest) {
    const pat = await verifyPAT(req, pool) // return object or throw; do not send reply
    if (!pat) {
      const err = new Error('Invalid PAT')
      ;(err as any).statusCode = 401
      throw err
    }
    req.auth = {
      ...(req.auth ?? {}),
      method: 'pat',
      userId: pat.user_id,
      patScopes: pat.scopes,
    }
    // Optional: backfill projectId for backward compatibility
    try {
      req.auth.projectId ??= await getDefaultProjectId(pool, pat.user_id)
        ; (req as any).project_id = req.auth.projectId
        ; (req as any).user_id = pat.user_id
        ; (req as any).pat_scopes = pat.scopes
    } catch { }
  }

  async function verifyApiKeyNoReply(req: FastifyRequest) {
    const ok = await verifyAPIKey(req, null as any, pool) // reply parameter not used by function
    if (!ok) {
      const err = new Error('Invalid API key')
      ;(err as any).statusCode = 401
      throw err
    }
    req.auth = { ...(req.auth ?? {}), method: 'apiKey' }
  }

  async function verifyHmacNoReply(req: FastifyRequest) {
    // If you need raw body, ensure a raw-body plugin is registered beforehand
    const ok = await verifyHMAC(req, null as any, pool) // reply parameter present but not critical for validation
    if (!ok) {
      const err = new Error('Invalid HMAC')
      ;(err as any).statusCode = 401
      throw err
    }
    req.auth = { ...(req.auth ?? {}), method: 'hmac' }
  }

  const defaultGuards: Record<SchemeName, FastifyAuthFunction> = {
    patAuth: asGuard(verifyPatNoReply),
    apiKeyAuth: asGuard(verifyApiKeyNoReply),
    sessionCookie: asGuard(verifySessionNoReply),
    hmacAuth: asGuard(verifyHmacNoReply),
  }

  const guards = { ...defaultGuards, ...opts.guards }

  function composeSecurity(sec?: Array<Record<string, string[]>>) {
    const effective = sec ?? opts.defaultSecurity
    if (!effective) return null
    if (Array.isArray(effective) && effective.length === 0) return 'public'

    const orGroups = effective.map((obj) => {
      const andHandlers = Object.keys(obj)
        .map((name) => guards[name as SchemeName])
        .filter(Boolean) as FastifyAuthFunction[]

      if (andHandlers.length === 0) return null
      // Combine with AND if multiple handlers are in one group
      return andHandlers.length === 1 ? andHandlers[0] : app.auth(andHandlers, { relation: 'and' })
    }).filter(Boolean) as FastifyAuthFunction[]

    if (orGroups.length === 0) return null
    // Combine with OR if multiple groups exist
    return orGroups.length === 1 ? orGroups[0] : app.auth(orGroups, { relation: 'or' })
  }

  app.addHook('onRoute', (route) => {
    const composed = composeSecurity(route.schema?.security as any)
    if (!composed || composed === 'public') return

    const existing = Array.isArray(route.preHandler)
      ? route.preHandler
      : route.preHandler
        ? [route.preHandler]
        : []
    route.preHandler = [composed, ...existing]
  })

  // Final 401 handler if all alternatives fail
  app.setErrorHandler((err, _req, reply) => {
    if (reply.sent) return // someone already replied
    if (err && (err.statusCode === 401 || err.code === 'FST_AUTH_NO_AUTH')) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Authentication failed' }
      })
    }
    // Fallback to default error handler
    reply.send(err)
  })
})