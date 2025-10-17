import type { FastifyInstance } from "fastify";
import type { Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { API_VERSION, ROUTES } from "../config.js";

/**
 * Registers health check endpoints for monitoring application status.
 * Includes status, health, and ready endpoints with different levels of dependency checks.
 */
export async function registerHealthRoutes(app: FastifyInstance, pool: Pool, redis: IORedisType): Promise<void> {
    // Status endpoint (public, no auth required)
    app.get(ROUTES.STATUS, async (): Promise<{ status: string; version: string; timestamp: string }> => ({
        status: "healthy",
        version: API_VERSION,
        timestamp: new Date().toISOString()
    }));

    // Health check endpoint (public, no auth required)
    app.get(ROUTES.HEALTH, async (): Promise<{ ok: true; timestamp: string; environment: string }> => ({
        ok: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    }));

    // Add a ready check that verifies all dependencies
    app.get(ROUTES.READY, async (): Promise<{ ready: boolean; checks: Record<string, boolean> }> => {
        const checks = {
            database: false,
            redis: false
        };

        try {
            // Check database
            const dbResult = await pool.query('SELECT 1');
            checks.database = dbResult.rows.length > 0;
        } catch (error) {
            app.log.error({ err: error }, 'Database health check failed');
        }

        try {
            // Check Redis
            await redis.ping();
            checks.redis = true;
        } catch (error) {
            app.log.error({ err: error }, 'Redis health check failed');
        }

        const ready = Object.values(checks).every(status => status);

        return { ready, checks };
    });
}