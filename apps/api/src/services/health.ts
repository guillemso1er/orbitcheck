import type { FastifyInstance, FastifyReply, RawServerBase } from "fastify";
import type { Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { API_VERSION } from "../config.js";

export async function getStatus(
    rep: FastifyReply
): Promise<FastifyReply> {
    const response = {
        status: "healthy",
        version: API_VERSION,
        timestamp: new Date().toISOString()
    };
    return rep.send(response);
}

export async function getHealth(
    rep: FastifyReply
): Promise<FastifyReply> {
    const response = {
        status: 'ok'
    };
    return rep.send(response);
}

export async function getReady<TServer extends RawServerBase = RawServerBase>(
    app: FastifyInstance<TServer>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply> {
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

    const response = { ready, checks };
    return rep.send(response);
}