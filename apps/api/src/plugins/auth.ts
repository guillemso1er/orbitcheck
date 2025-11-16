import fastifyAuth, { FastifyAuthFunction } from '@fastify/auth'
import openapiSpec from '@orbitcheck/contracts/openapi.v1.json' with { type: 'json' }
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Pool } from 'pg'
import { routes } from '../routes/routes.js'
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
  | 'cookieAuth'
  | 'cookieAuth'        // new alias to match OpenAPI scheme
  | 'httpMessageSigAuth'
  | 'csrfHeader'        // new CSRF scheme
  | 'shopifySessionToken'

interface Options {
  pool: Pool
  defaultSecurity?: Array<Record<string, string[]>>
  guards?: Partial<Record<SchemeName, FastifyAuthFunction>>
  allowedOrigins?: string[] // for Origin/Referer validation on mutating requests
}

export default fp<Options>(async function openapiSecurity(app, opts) {
  app.register(fastifyAuth)
  const { pool } = opts

  const spec = openapiSpec

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
    (opts.allowedOrigins && opts.allowedOrigins.length ? opts.allowedOrigins : [
      process.env.DASHBOARD_ORIGIN || 'https://dashboard.orbitcheck.io',
      process.env.API_ORIGIN || 'https://api.orbitcheck.io',
      ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000',
        'http://localhost:5173', 'http://127.0.0.1:3000',
        'http://127.0.0.1:5173', 'http://localhost:8080', 'http://127.0.0.1:8080'] : [])
    ]).map(s => s.toLowerCase())
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

    // Skip CSRF check for auth routes (login, register, logout)
    const url = req.url
    if (url === routes.auth.loginUser || url === routes.auth.registerUser || url === routes.auth.logoutUser) return

    // Skip CSRF token check for requests from allowed origins (e.g., Swagger UI on API domain)
    if (originMatches(req)) return

    const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-xsrf-token'] as string | undefined)
    const cookieToken = req.cookies?.csrf_token

    // For double-submit pattern: token must be present in both cookie and header and match
    const hasValidCsrfTokens = headerToken && cookieToken && headerToken === cookieToken

    console.log("CSRF check - method:", method, "headerToken:", headerToken, "cookieToken:", cookieToken, "hasValidCsrfTokens:", hasValidCsrfTokens)

    if (!hasValidCsrfTokens) {
      const err = new Error('Invalid CSRF token')
        ; (err as any).statusCode = 403
        ; (err as any).code = 'FORBIDDEN'
      throw err
    }
  }

  const defaultGuards: Partial<Record<SchemeName, FastifyAuthFunction>> = {
    patAuth: asGuard(verifyPatNoReply),
    apiKeyAuth: asGuard(verifyApiKeyNoReply),
    cookieAuth: asGuard(verifySessionNoReply),
    httpMessageSigAuth: asGuard(verifyHttpMessageSignatureNoReply),
    csrfHeader: asGuard(verifyCsrfNoReply),
  }

  const guards = { ...defaultGuards, ...opts.guards } as Partial<Record<SchemeName, FastifyAuthFunction>>

  const guardMap: Record<string, FastifyAuthFunction | undefined> = {
    patAuth: guards.patAuth,
    apiKeyAuth: guards.apiKeyAuth,
    cookieAuth: guards.cookieAuth,
    httpMessageSigInput: guards.httpMessageSigAuth,
    httpMessageSig: guards.httpMessageSigAuth,
    csrfHeader: guards.csrfHeader,
    shopifySessionToken: guards.shopifySessionToken,
    shopifysessiontoken: guards.shopifySessionToken,
  }

  function composeSecurity(sec?: Array<Record<string, string[]>>) {
    const effective = sec ?? opts.defaultSecurity
    if (!effective) return null
    if (Array.isArray(effective) && effective.length === 0) return 'public' as any

    const orGroups = effective.map((obj) => {
      const andHandlers = [...new Set(Object.keys(obj)
        .map((name) => guardMap[name] || guardMap[name.toLowerCase()])
        .filter(Boolean) as FastifyAuthFunction[])]

      // Enforce CSRF protection for cookie authentication on state-changing methods
      if (guards.cookieAuth && guards.csrfHeader && andHandlers.some(handler => handler === guards.cookieAuth)) {
        andHandlers.push(guards.csrfHeader)
      }

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