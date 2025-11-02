import ScalarApiReference from '@scalar/fastify-api-reference'
import type { FastifyInstance, RawServerBase } from 'fastify'
import type { Pool } from 'pg'

import { authenticateRequest } from '../web.js'

export async function registerAuthenticatedDocsRoutes<TServer extends RawServerBase = RawServerBase>(app: FastifyInstance<TServer>, pool: Pool): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      await authenticateRequest(req, reply, pool)
    })

    await scope.register(ScalarApiReference, {
      routePrefix: '/api-reference',
      // configuration: { ... } // optional UI tweaks
    })
  })
}