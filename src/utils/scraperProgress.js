/**
 * scraperProgress.js
 *
 * Thin Redis wrapper that persists the latest scraper event for a user.
 * The controller reads this on every poll so the frontend can recover
 * full state on page refresh — including error messages and saved counts.
 *
 * Shape stored in Redis:
 * {
 *   event:     string          – last socket event name  (e.g. 'scraper:failed')
 *   percent:   number          – 0-100 progress
 *   label:     string          – human-readable stage label
 *   error:     string | null   – error message if partial/failed
 *   count:     number | null   – leads flushed to Mongo before stop
 *   stage:     string          – alias for event (legacy compat)
 *   updatedAt: number          – unix ms timestamp
 * }
 */

import redisClient from "../config/redis.js";

const RUNNING_TTL = 60 * 60; // 1 hour
const FINISHED_TTL = 60 * 2; // 2 minutes

function progressKey(userId) {
    return `scraper:progress:${userId}`;
}

/**
 * Returns TTL based on event
 */
function getTTL(event) {
    if (event === "scraper:completed" || event === "scraper:failed") {
        return FINISHED_TTL;
    }
    return RUNNING_TTL;
}

/**
 * setScraperProgress
 * Called inside emitToUser() in the worker so every socket emission
 * is also persisted to Redis for polling fallback.
 *
 * @param {{ userId: string, event: string, data?: object }} opts
 */
export async function setScraperProgress({ userId, event, data = {} }) {
    if (!userId) return;

    const payload = {
        event,
        percent: typeof data.percent === "number" ? data.percent : 0,
        label: typeof data.label === "string" ? data.label : "",
        error: data.error != null ? String(data.error) : null,
        count: data.count != null ? Number(data.count) : null,
        stage: event,
        updatedAt: Date.now(),
    };

    try {
        await redisClient.set(
            progressKey(userId),
            JSON.stringify(payload),
            "EX",
            getTTL(event)
        );
    } catch (err) {
        // Non-fatal — scraping continues even if Redis write fails
        console.error("[scraperProgress] setScraperProgress failed", {
            userId,
            event,
            error: err.message,
        });
    }
}

/**
 * getScraperProgress
 * Returns the stored payload, or a safe "idle" default if the key is missing.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getScraperProgress(userId) {
    const IDLE = {
        event: "idle",
        percent: 0,
        label: "",
        error: null,
        count: null,
        stage: "idle",
        updatedAt: null,
    };

    if (!userId) return IDLE;

    try {
        const raw = await redisClient.get(progressKey(userId));
        if (!raw) return IDLE;

        const parsed = JSON.parse(raw);

        return {
            event: parsed.event ?? "idle",
            percent: parsed.percent ?? 0,
            label: parsed.label ?? "",
            error: parsed.error ?? null,
            count: parsed.count ?? null,
            stage: parsed.stage ?? parsed.event ?? "idle",
            updatedAt: parsed.updatedAt ?? null,
        };
    } catch (err) {
        console.error("[scraperProgress] getScraperProgress failed", {
            userId,
            error: err.message,
        });

        return IDLE;
    }
}

/**
 * clearScraperProgress
 * Optionally called after the user explicitly dismisses the banner,
 * or when a new scrape session starts.
 *
 * @param {string} userId
 */
export async function clearScraperProgress(userId) {
    if (!userId) return;

    try {
        await redisClient.del(progressKey(userId));
    } catch (err) {
        console.error("[scraperProgress] clearScraperProgress failed", {
            userId,
            error: err.message,
        });
    }
}


export const setGoogleLeadsApiProgress = async ({ userId, event, data }) => {
    try {
        const key = `progress:${userId}`
        const payload = JSON.stringify({ event, data, updatedAt: Date.now() })
        console.log(payload)
        await redisClient.set(key, payload, 'EX', 60 * 30) // 30 min TTL
    } catch (err) {
        logger.error('[PROGRESS] setScraperProgress failed', { error: err.message })
    }
}

export const getGoogleLeadsApiProgress = async (userId) => {
    try {
        const key = `progress:${userId}`
        const raw = await redisClient.get(key)
        console.log(raw)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}