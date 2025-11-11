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

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  const specPath = path.resolve(__dirname, '../../../../packages/contracts/dist/openapi.v1.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'))

  // Convert OpenAPI "{id}" style to Fastify ":id" style
  const toFastifyPath = (p: string) => p.replace(/{([^}/]+)}/g, ':$1')

  // Build a map of route -> security requirements using Fastify-style paths
  const routeSecurityMap = new Map<string, Array<Record<string, string[]>>>()
  for (const [routePath, methods] of Object.entries(spec.paths || {})) {
    const fPath = toFastifyPath(routePath)
    for (const [method, operation] of Object.entries(methods as any)) {
      if (operation && typeof operation === 'object' && 'security' in operation && Array.isArray(operation.security)) {
        const key = `${String(method).toUpperCase()} ${fPath}`
        routeSecurityMap.set(key, operation.security as Array<Record<string, string[]>>)
      }
    }
  }

  const asGuard = (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>): FastifyAuthFunction =>
    async (req, reply) => { await fn(req, reply) }

  // --- Verification Functions (No Reply Logic) ---

  async function verifySessionNoReply(req: FastifyRequest) {
    try {
      await verifySession(req, pool) // Throws on failure
      // Make sure user_id is actually present on req for downstream code
      if (!(req as any).user_id && (req as any).session?.get) {
        const uid = (req as any).session.get('user_id')
        if (uid) (req as any).user_id = uid
      }
      req.auth = { ...(req.auth ?? {}), method: 'session', userId: (req as any).user_id }
    } catch (error: any) {
      const err = new Error(error?.error?.message || 'Session authentication required')
        ; (err as any).statusCode = error?.status || 401
        ; (err as any).code = error?.error?.code || 'UNAUTHORIZED'
      throw err
    }
  }

  async function verifyPatNoReply(req: FastifyRequest) {
    const pat = await verifyPAT(req, pool)
    if (!pat) {
      const err = new Error('Invalid or missing PAT')
        ; (err as any).statusCode = 401
        ; (err as any).code = 'UNAUTHORIZED'
      throw err
    }
    ; (req as any).user_id = pat.user_id
      ; (req as any).pat_scopes = pat.scopes
    req.auth = { ...(req.auth ?? {}), method: 'pat', userId: pat.user_id, patScopes: pat.scopes }

    try {
      req.auth.projectId ??= await getDefaultProjectId(pool, pat.user_id)
        ; (req as any).project_id = req.auth.projectId
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
    httpMessageSigAuth: asGuard(verifyHttpMessageSignatureNoReply),
  }

  const guards = { ...defaultGuards, ...opts.guards }

  const guardMap: Record<string, FastifyAuthFunction> = {
    patAuth: guards.patAuth,
    apiKeyAuth: guards.apiKeyAuth,
    sessionCookie: guards.sessionCookie,
    httpMessageSigInput: guards.httpMessageSigAuth,
    httpMessageSig: guards.httpMessageSigAuth,
  }

  function composeSecurity(sec?: Array<Record<string, string[]>>) {
    const effective = sec ?? opts.defaultSecurity
    if (!effective) return null
    if (Array.isArray(effective) && effective.length === 0) return 'public' as any

    const orGroups = effective.map((obj) => {
      const andHandlers = [...new Set(Object.keys(obj)
        .map((name) => guardMap[name] || guardMap[name.toLowerCase()])
        .filter(Boolean) as FastifyAuthFunction[])]

      if (andHandlers.length === 0) return null
      // For single handler, return it directly
      if (andHandlers.length === 1) return andHandlers[0]
      // For multiple handlers in same security object, use AND relation
      return app.auth(andHandlers, { relation: 'and' })
    }).filter(Boolean) as FastifyAuthFunction[]

    if (orGroups.length === 0) return null
    // For multiple security alternatives, use OR relation
    return orGroups.length === 1 ? orGroups[0] : app.auth(orGroups, { relation: 'or' })
  }

  app.addHook('onRoute', (route) => {
    // route.method can be string | string[]
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const m of methods) {
      const key = `${String(m).toUpperCase()} ${route.url}`
      const security = routeSecurityMap.get(key)
      const composed = composeSecurity(security)
      if (!composed || composed === 'public') {
        continue
      }

      // Attach to preValidation so it runs before any global preHandler hooks
      const existing = Array.isArray(route.preValidation)
        ? route.preValidation
        : route.preValidation ? [route.preValidation] : []

      route.preValidation = [composed, ...existing]
    }
  })
})