import type { Job } from "bullmq";
import { Redis } from 'ioredis';
import fetch from "node-fetch";

import { environment } from "../environment.js";
import { BATCH_SIZE_DISPOSABLE_UPDATE } from "../config.js";

export const disposableProcessor = async (job: Job): Promise<void> => {
    // Determine if we need to create a new Redis client or use an existing one.
    const isRedisProvided = !!job.data?.redis;
    const redis = isRedisProvided ? job.data.redis : new Redis(environment.REDIS_URL);

    try {
        console.warn("Refreshing disposable domains list...");
        const r = await fetch(environment.DISPOSABLE_LIST_URL);
        const list = await r.json() as string[];

        const key = "disposable_domains";
        const temporary = `${key}_tmp`;
        await redis.del(temporary);

        const batchSize = BATCH_SIZE_DISPOSABLE_UPDATE;
        console.warn(`Processing ${list.length} domains in batches of ${batchSize}...`);

        const promises = [];
        for (let index = 0; index < list.length; index += batchSize) {
            const batch = list.slice(index, index + batchSize);
            if (batch.length > 0) {
                // Use a single SADD command with multiple arguments via spread syntax.
                promises.push(redis.sadd(temporary, ...batch));
            }
        }
        await Promise.all(promises);

        await redis.rename(temporary, key);
        console.warn(`Successfully loaded ${list.length} disposable domains.`);
    } catch (error) {
        console.error("Failed to refresh disposable domains:", error);
        throw error; // Let BullMQ handle retries
    } finally {
        // IMPORTANT: Only quit the connection if this processor created it.
        if (!isRedisProvided) {
            await redis.quit();
        }
    }
};