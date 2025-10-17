import ScalarApiReference from '@scalar/fastify-api-reference'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

import { authenticateRequest } from '../web.js'

export async function registerAuthenticatedDocsRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
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