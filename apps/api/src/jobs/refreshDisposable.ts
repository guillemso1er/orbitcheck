import IORedis from "ioredis";
import fetch from "node-fetch";
import { env } from "../env";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const disposableProcessor = async (job: any) => {
    // This connection logic can be improved later, but it's not the cause of the block.
    const redis = new IORedis(env.REDIS_URL);
    try {
        console.log("Refreshing disposable domains list...");
        const r = await fetch(env.DISPOSABLE_LIST_URL);
        const list = await r.json(); // This is fast enough, as proven by the logs.

        const key = "disposable_domains";
        const tmp = key + "_tmp";
        await redis.del(tmp);

        const batchSize = 5000;
        console.log(`Processing ${list.length} domains in batches of ${batchSize}...`);

        for (let i = 0; i < list.length; i += batchSize) {
            const batch = list.slice(i, i + batchSize);
            if (batch.length > 0) {
                // --- THIS IS THE FIX ---
                // Instead of a pipeline, use a single SADD command with multiple arguments.
                // The spread syntax (...) unpacks the array into arguments.
                await redis.sadd(tmp, ...batch);
                sleep(1); 

            }
        }

        await redis.rename(tmp, key);
        console.log(`Successfully loaded ${list.length} disposable domains.`);
    } catch (error) {
        console.error("Failed to refresh disposable domains:", error);
        throw error; // Let BullMQ handle retries
    } finally {
        await redis.quit();
    }
};