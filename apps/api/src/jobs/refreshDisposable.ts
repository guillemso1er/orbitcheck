import IORedis from "ioredis";
import fetch from "node-fetch";
import { env } from "../env";

// Turn it into an exportable function
export async function refreshDisposableDomains() {
    const redis = new IORedis(env.REDIS_URL);
    try {
        console.log("Refreshing disposable domains list...");
        const r = await fetch(env.DISPOSABLE_LIST_URL);
        const list = await r.json();

        const key = "disposable_domains";
        const tmp = key + "_tmp";
        await redis.del(tmp);
        // More efficient pipeline for Redis
        const pipeline = redis.pipeline();
        for (const d of list) {
            pipeline.sadd(tmp, d);
        }
        await pipeline.exec();

        await redis.rename(tmp, key);
        console.log(`Successfully loaded ${list.length} disposable domains.`);
    } catch (error) {
        console.error("Failed to refresh disposable domains:", error);
    } finally {
        await redis.quit();
    }
}