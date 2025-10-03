import type { Job } from "bullmq";
import IORedis from "ioredis";
import fetch from "node-fetch";

import { environment } from "../env.js";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const disposableProcessor = async (job: Job) => {
    // Determine if we need to create a new Redis client or use an existing one.
    const isRedisProvided = !!job.data?.redis;
    const redis = isRedisProvided ? job.data.redis : new IORedis(environment.REDIS_URL);

    try {
        console.log("Refreshing disposable domains list...");
        const r = await fetch(environment.DISPOSABLE_LIST_URL);
        const list = await r.json() as string[];

        const key = "disposable_domains";
        const temporary = `${key}_tmp`;
        await redis.del(temporary);

        const batchSize = 5000;
        console.log(`Processing ${list.length} domains in batches of ${batchSize}...`);

        for (let index = 0; index < list.length; index += batchSize) {
            const batch = list.slice(index, index + batchSize);
            if (batch.length > 0) {
                // Use a single SADD command with multiple arguments via spread syntax.
                await redis.sadd(temporary, ...batch);
                await sleep(1);
            }
        }

        await redis.rename(temporary, key);
        console.log(`Successfully loaded ${list.length} disposable domains.`);
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