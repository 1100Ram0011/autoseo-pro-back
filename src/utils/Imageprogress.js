// utils/ImageProgress.js
// Mirrors analysisProgress.js — stores Image generation stage in Redis
// so the frontend can poll/refetch and always get the current state.

import redisClient from "../config/redis.js";
import logger from "../config/logger.js";

const TTL = 60 * 60 * 2; // 2 hours — enough for any generation run

/**
 * Key format: Image:progress:{userId}:{websiteHash}
 * Stored as JSON so we can hold extra fields (counts, totals, errors).
 */
function buildKey(userId, websiteHash) {
    return `image:progress:${userId}:${websiteHash}`;
}

/**
 * Write (or overwrite) progress to Redis.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.websiteHash
 * @param {string} params.stage        - e.g. "Image_STARTED", "Image_GENERATING" …
 * @param {number} [params.current]    - item index currently being processed (1-based)
 * @param {number} [params.total]      - total items in this phase
 * @param {string} [params.label]      - human-readable label for the current item
 * @param {string} [params.error]      - error message when stage === "FAILED"
 */
export async function setImageProgress({
    userId,
    websiteHash,
    stage,
    current = null,
    total = null,
    label = null,
    error = null,
}) {
    try {
        const key = buildKey(userId, websiteHash);
        const payload = JSON.stringify({
            stage,
            current,
            total,
            label,
            error,
            updatedAt: Date.now(),
        });

        await redisClient.set(key, payload, "EX", TTL);

        logger.info(`[ImageProgress] ${stage}`, {
            userId,
            websiteHash,
            current,
            total,
        });
    } catch (err) {
        // Non-fatal — progress is best-effort
        logger.error("[ImageProgress] Failed to write progress", {
            error: err.message,
        });
    }
}

/**
 * Read current progress from Redis.
 * Returns null if no record exists (job hasn't started or expired).
 */
export async function getImageProgress(userId, websiteHash) {
    try {
        const key = buildKey(userId, websiteHash);
        const raw = await redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        logger.error("[ImageProgress] Failed to read progress", {
            error: err.message,
        });
        return null;
    }
}

/**
 * Delete the progress key once it's been consumed / no longer needed.
 */
export async function clearImageProgress(userId, websiteHash) {
    try {
        await redisClient.del(buildKey(userId, websiteHash));
    } catch (_) {
        // ignore
    }
}