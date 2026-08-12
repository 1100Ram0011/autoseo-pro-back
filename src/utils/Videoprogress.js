// utils/videoProgress.js

import redisClient from "../config/redis.js";
import logger from "../config/logger.js";
import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";

const TTL = 60 * 60 * 2; // 2 hours

function buildKey(userId, websiteHash) {
    return `video:progress:${userId}:${websiteHash}`;
}

/**
 * Write progress to Redis cache
 */
export async function setVideoProgress({
    userId,
    websiteHash,
    stage,
    current = null,
    total = null,
    label = null,
    error = null,
}) {
    if (!userId || !websiteHash) {
        logger.warn("[VideoProgress] Invalid cache key params", {
            userId,
            websiteHash,
        });
        return;
    }

    try {
        const key = buildKey(userId, websiteHash);

        const percent =
            current && total ? Math.round((current / total) * 100) : null;

        const payload = JSON.stringify({
            stage,
            current,
            total,
            percent,
            label,
            error,
            updatedAt: Date.now(),
        });

        await redisClient.set(key, payload, "EX", TTL);

        logger.info("[VideoProgress] Cache updated", {
            key,
            stage,
            current,
            total,
        });

    } catch (err) {
        // Cache failure should NOT break worker
        logger.error("[VideoProgress] Redis cache write failed", {
            error: err.message,
            userId,
            websiteHash,
        });
    }
}

/**
 * Read progress from Redis cache
 */
export async function getVideoProgress(userId) {
    if (!userId) return null;

    try {
        const profile = await BusinessSummaryProfile
            .findOne({ userId })
            .select("websiteHash")
            .lean();

        if (!profile?.websiteHash) return null;

        const key = buildKey(userId, profile.websiteHash);

        const raw = await redisClient.get(key);
        if (!raw) return null;

        return JSON.parse(raw);

    } catch (err) {
        logger.error("[VideoProgress] Redis cache read failed", {
            userId,
            error: err.message,
        });

        return null;
    }
}

/**
 * Clear progress cache
 */
export async function clearVideoProgress(userId, websiteHash) {
    try {
        const key = buildKey(userId, websiteHash);
        await redisClient.del(key);

        logger.info("[VideoProgress] Cache cleared", { key });

    } catch (err) {
        logger.error("[VideoProgress] Redis cache delete failed", {
            userId,
            websiteHash,
            error: err.message,
        });
    }
}