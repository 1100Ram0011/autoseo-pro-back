
import redisClient from "../config/redis.js";
import { io } from "../socket.js";

export async function updateFirecrawlLoader({
    userId,
    websiteHash,
    step,
    progress,
    message,
}) {
    const key = `firecrawl:loader:${userId}:${websiteHash}`;

    const payload = {
        step,
        progress,
        message,
        updatedAt: Date.now(),
    };

    await redisClient.set(key, JSON.stringify(payload));
    io.to(userId.toString()).emit("firecrawl:progress", payload);
}

export async function getFirecrawlLoader(userId, websiteHash) {
    const key = `firecrawl:loader:${userId}:${websiteHash}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
}
