import fastifyAuth, { FastifyAuthFunction } from '@fastify/auth'
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { verifyAPIKey, verifyHttpMessageSignature, verifyPAT, verifySession } from '../services/auth.js'
import { getDefaultProjectId } from '../services/utils.js'

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

type SchemeName =
  | 'patAuth'
  | 'apiKeyAuth'
  | 'sessionCookie'
  | 'cookieAuth'        // new alias to match OpenAPI scheme
  | 'httpMessageSigAuth'
  | 'csrfHeader'        // new CSRF scheme

interface Options {
  pool: Pool
  defaultSecurity?: Array<Record<string, string[]>>
  guards?: Partial<Record<SchemeName, FastifyAuthFunction>>
  allowedOrigins?: string[] // for Origin/Referer validation on mutating requests
}

export default fp<Options>(async function openapiSecurity(app, opts) {
  app.register(fastifyAuth)
  const { pool } = opts

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const specPath = path.resolve(__dirname, '../../../../packages/contracts/dist/openapi.v1.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'))

  const toFastifyPath = (p: string) => p.replace(/{([^}/]+)}/g, ':$1')

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

  async function verifySessionNoReply(req: FastifyRequest) {
    try {
      await verifySession(req, pool)
      const uid = (req as any).user_id ??
        (req as any).session?.user_id ??
        (req as any).session?.get?.('user_id')
      req.auth = { ...(req.auth ?? {}), method: 'session', userId: uid }
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

  // CSRF guard: header + Origin/Referer check
  const allowedOrigins = new Set(
    (opts.allowedOrigins && opts.allowedOrigins.length ? opts.allowedOrigins : [process.env.DASHBOARD_ORIGIN || 'https://dashboard.orbitcheck.io']).map(s => s.toLowerCase())
  )

  function originMatches(req: FastifyRequest): boolean {
    const origin = (req.headers.origin || '').toLowerCase()
    if (origin && allowedOrigins.has(origin)) return true
    const ref = (req.headers.referer || '').toLowerCase()
    if (ref) {
      try {
        const refOrigin = new URL(ref).origin.toLowerCase()
        if (allowedOrigins.has(refOrigin)) return true
      } catch { }
    }
    // Also allow same-origin calls (rare if API is only api.*)
    const host = (req.headers.host || '').toLowerCase()
    if (origin && new URL(origin).host === host) return true
    return false
  }

  async function verifyCsrfNoReply(req: FastifyRequest) {
    const method = String(req.method).toUpperCase()
    // Only enforce for state-changing methods; GET/HEAD/OPTIONS pass
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    if (!originMatches(req)) {
      const err = new Error('Invalid request origin')
        ; (err as any).statusCode = 403
        ; (err as any).code = 'FORBIDDEN'
      throw err
    }
    const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-xsrf-token'] as string | undefined)
    const sessionToken =
      (req as any).session?.csrf_token ??
      (req as any).session?.get?.('csrf_token')

    if (!headerToken || !sessionToken || headerToken !== sessionToken) {
      const err = new Error('Invalid CSRF token')
        ; (err as any).statusCode = 403
        ; (err as any).code = 'FORBIDDEN'
      throw err
    }
  }

  const defaultGuards: Record<SchemeName, FastifyAuthFunction> = {
    patAuth: asGuard(verifyPatNoReply),
    apiKeyAuth: asGuard(verifyApiKeyNoReply),
    sessionCookie: asGuard(verifySessionNoReply),
    cookieAuth: asGuard(verifySessionNoReply),      // alias for OpenAPI cookieAuth
    httpMessageSigAuth: asGuard(verifyHttpMessageSignatureNoReply),
    csrfHeader: asGuard(verifyCsrfNoReply),
  }

  const guards = { ...defaultGuards, ...opts.guards }

  const guardMap: Record<string, FastifyAuthFunction> = {
    patAuth: guards.patAuth,
    apiKeyAuth: guards.apiKeyAuth,
    sessionCookie: guards.sessionCookie,
    cookieAuth: guards.cookieAuth,
    httpMessageSigInput: guards.httpMessageSigAuth,
    httpMessageSig: guards.httpMessageSigAuth,
    csrfHeader: guards.csrfHeader,
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
      if (andHandlers.length === 1) return andHandlers[0]
      return app.auth(andHandlers, { relation: 'and' })
    }).filter(Boolean) as FastifyAuthFunction[]

    if (orGroups.length === 0) return null
    return orGroups.length === 1 ? orGroups[0] : app.auth(orGroups, { relation: 'or' })
  }

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const m of methods) {
      const key = `${String(m).toUpperCase()} ${route.url}`
      const security = routeSecurityMap.get(key)
      const composed = composeSecurity(security)
      if (!composed || composed === 'public') continue

      const existing = Array.isArray(route.preValidation)
        ? route.preValidation
        : route.preValidation ? [route.preValidation] : []

      route.preValidation = [composed, ...existing]
    }
  })
})