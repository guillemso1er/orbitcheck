import type { FastifyReply } from "fastify";
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

export async function getReady(
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply> {
    const checks = {
        database: false,
        redis: false
    };

    try {
        const dbResult = await pool.query('SELECT 1');
        checks.database = dbResult.rows.length > 0;
    } catch (error) {
        // Database check failed
    }

    try {
        await redis.ping();
        checks.redis = true;
    } catch (error) {
        // Redis check failed
    }

    const ready = Object.values(checks).every(status => status);

    const response = { ready, checks };
    return rep.send(response);
}