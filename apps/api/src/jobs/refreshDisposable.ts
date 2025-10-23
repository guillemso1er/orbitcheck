import type { Job } from "bullmq";
import { Redis } from 'ioredis';

import { BATCH_SIZE_DISPOSABLE_UPDATE } from "../config.js";
import { environment } from "../environment.js";

export const disposableProcessor = async (job: Job): Promise<void> => {
    // Determine if we need to create a new Redis client or use an existing one.
    const isRedisProvided = !!job.data?.redis;
    const redis = isRedisProvided ? job.data.redis : new Redis(environment.REDIS_URL);

    try {
        console.warn("Refreshing disposable domains list...");
        const r = await fetch(environment.DISPOSABLE_LIST_URL);
        if (!r.ok) {
            throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        const text = await r.text();
        let list: string[];
        try {
            list = JSON.parse(text) as string[];
        } catch (parseError) {
            console.error("Failed to parse JSON response:", parseError);
            console.error("Response text (first 200 chars):", text.substring(0, 200));
            throw parseError;
        }

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