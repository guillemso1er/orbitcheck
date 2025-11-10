import fastifyAuth, { FastifyAuthFunction } from '@fastify/auth'
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
// Assuming these are your existing service functions
import { verifyAPIKey, verifyHttpMessageSignature, verifyPAT, verifySession } from '../services/auth.js'
import { getDefaultProjectId } from '../services/utils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Unify the identity object attached by any auth method
declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      method: 'session' | 'pat' | 'apiKey' | 'httpMessageSignature'
      userId?: string
      patScopes?: string[]
      projectId?: string
      apiKeyId?: string
    }
  }
}

// Updated scheme names to match the new security architecture
type SchemeName = 'patAuth' | 'apiKeyAuth' | 'sessionCookie' | 'httpMessageSigAuth'

interface Options {
  pool: Pool
  defaultSecurity?: Array<Record<string, string[]>>
  // Override any guard if needed
  guards?: Partial<Record<SchemeName, FastifyAuthFunction>>
}

export default fp<Options>(async function openapiSecurity(app, opts) {
  app.register(fastifyAuth)

  const { pool } = opts

  // Load OpenAPI spec to get security requirements
  // __dirname will be something like /home/user/orbicheck/apps/api/src/plugins
  // We need to go up to workspace root: ../../../.. then into packages/contracts/dist
  const specPath = path.resolve(__dirname, '../../../../packages/contracts/dist/openapi.v1.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'))

  // Build a map of route -> security requirements
  const routeSecurityMap = new Map<string, Array<Record<string, string[]>>>()
  for (const [routePath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods as any)) {
      if (operation && typeof operation === 'object' && 'security' in operation && Array.isArray(operation.security)) {
        const key = `${method.toUpperCase()} ${routePath}`
        routeSecurityMap.set(key, operation.security as Array<Record<string, string[]>>)
      }
    }
  }

  // Helper to wrap async checks into auth guards
  const asGuard = (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>): FastifyAuthFunction =>
    async (req, reply) => { await fn(req, reply) } // throw to fail

  // --- Verification Functions (No Reply Logic) ---

  async function verifySessionNoReply(req: FastifyRequest) {
    try {
      await verifySession(req, pool) // Throws on failure
      req.auth = { ...(req.auth ?? {}), method: 'session', userId: (req as any).user_id }
    } catch (error: any) {
      // Convert the thrown object to a proper Error with statusCode
      const err = new Error(error.error?.message || 'Session authentication required')
        ; (err as any).statusCode = error.status || 401
        ; (err as any).code = error.error?.code || 'UNAUTHORIZED'
      throw err
    }
  }

  async function verifyPatNoReply(req: FastifyRequest) {
    const pat = await verifyPAT(req, pool) // Returns PAT object or null
    if (!pat) {
      const err = new Error('Invalid or missing PAT')
        ; (err as any).statusCode = 401
        ; (err as any).code = 'UNAUTHORIZED'
      throw err
    }
    req.auth = {
      ...(req.auth ?? {}),
      method: 'pat',
      userId: pat.user_id,
      patScopes: pat.scopes,
    }
    // Optional: Backfill projectId for backward compatibility
    try {
      req.auth.projectId ??= await getDefaultProjectId(pool, pat.user_id)
        ; (req as any).project_id = req.auth.projectId
        ; (req as any).user_id = pat.user_id
        ; (req as any).pat_scopes = pat.scopes
    } catch { }
  }

  async function verifyApiKeyNoReply(req: FastifyRequest) {
    const ok = await verifyAPIKey(req, pool)
    if (!ok) {
      const err = new Error('Invalid or missing API key')
        ; (err as any).statusCode = 401
        ; (err as any).code = 'UNAUTHORIZED'
      throw err
    }
    req.auth = { ...(req.auth ?? {}), method: 'apiKey', projectId: (req as any).project_id }
  }

  async function verifyHttpMessageSignatureNoReply(req: FastifyRequest) {
    const ok = await verifyHttpMessageSignature(req, pool)
    if (!ok) {
      const err = new Error('Invalid or missing HTTP Message Signature')
        ; (err as any).statusCode = 401
        ; (err as any).code = 'UNAUTHORIZED'
      throw err
    }
    req.auth = { ...(req.auth ?? {}), method: 'httpMessageSignature', projectId: (req as any).project_id }
  }

  const defaultGuards: Record<SchemeName, FastifyAuthFunction> = {
    patAuth: asGuard(verifyPatNoReply),
    apiKeyAuth: asGuard(verifyApiKeyNoReply),
    sessionCookie: asGuard(verifySessionNoReply),
    // Map the new signature scheme to its verification guard
    httpMessageSigAuth: asGuard(verifyHttpMessageSignatureNoReply),
  }

  const guards = { ...defaultGuards, ...opts.guards }

  // Maps OpenAPI scheme names to our internal guard functions
  const guardMap: Record<string, FastifyAuthFunction> = {
    patAuth: guards.patAuth,
    apiKeyAuth: guards.apiKeyAuth,
    sessionCookie: guards.sessionCookie,
    // Both RFC 9421 headers are handled by the same guard
    httpMessageSigInput: guards.httpMessageSigAuth,
    httpMessageSig: guards.httpMessageSigAuth,
  }

  function composeSecurity(sec?: Array<Record<string, string[]>>) {
    const effective = sec ?? opts.defaultSecurity
    if (!effective) return null
    if (Array.isArray(effective) && effective.length === 0) return 'public'

    const orGroups = effective.map((obj) => {
      // Use a Set to ensure a guard is only added once per 'AND' group
      const andHandlers = [...new Set(Object.keys(obj)
        .map((name) => guardMap[name])
        .filter(Boolean) as FastifyAuthFunction[])]

      if (andHandlers.length === 0) return null
      // Combine with AND if multiple handlers are in one group
      return andHandlers.length === 1 ? andHandlers[0] : app.auth(andHandlers, { relation: 'and' })
    }).filter(Boolean) as FastifyAuthFunction[]

    if (orGroups.length === 0) return null
    // Combine with OR if multiple groups exist
    return orGroups.length === 1 ? orGroups[0] : app.auth(orGroups, { relation: 'or' })
  }

  app.addHook('onRoute', (route) => {
    const routeKey = `${route.method} ${route.url}`
    const security = routeSecurityMap.get(routeKey)

    const composed = composeSecurity(security)
    if (!composed || composed === 'public') {
      return
    }

    const existing = Array.isArray(route.preHandler)
      ? route.preHandler
      : route.preHandler ? [route.preHandler] : []
    route.preHandler = [composed, ...existing]
  })
})