import redisClient from "../config/redis.js";
import { INDIVIDUAL_ANALYSIS_STAGES, PROGRESS_STAGES } from "../constants/progressStages.js";

export async function setProgress({ userId, websiteHash, stage, error }) {
    const meta = PROGRESS_STAGES[stage];

    const payload = {
        stage,
        percent: meta.percent,
        label: meta.label,
        updatedAt: Date.now(),
        error
    };

    await redisClient.set(
        `analysis:progress:${userId}:${websiteHash}`,
        JSON.stringify(payload),
        "EX",
        60 * 30
    );

    // Emit real-time progress sync to the frontend via socket
    const socketPayload = JSON.stringify({
        userId: userId.toString(),
        event: "analysis:progress:sync",
        data: { websiteHash, stage, percent: meta.percent, label: meta.label, error }
    });
    await redisClient.publish("socket:user", socketPayload);
}

export async function getProgress(userId, websiteHash) {
    const key = `analysis:progress:${userId}:${websiteHash}`;

    const data = await redisClient.get(key);

    if (!data) {
        return {
            stage: "PENDING",
            percent: 0,
            label: "Queued",
            error: null
        };
    }

    try {
        return JSON.parse(data);
    } catch {
        return {
            stage: "PENDING",
            percent: 0,
            label: "Queued",
            error: null
        };
    }
}

export async function clearProgress(userId, websiteHash) {
    const key = `analysis:progress:${userId}:${websiteHash}`;
    await redisClient.del(key);
}

export async function setIndividualProgress({ userId, profileId, stage, error = null }) {
    const meta = INDIVIDUAL_ANALYSIS_STAGES[stage];

    if (!meta) {
        throw new Error(
            `Unknown individual analysis stage: "${stage}". ` +
            `Valid stages: ${Object.keys(INDIVIDUAL_ANALYSIS_STAGES).join(", ")}`
        );
    }

    const payload = {
        stage,
        percent: meta.percent,
        label: meta.label,
        updatedAt: Date.now(),
        error,
    };

    await redisClient.set(
        `individual:progress:${userId}:${profileId}`,
        JSON.stringify(payload),
        "EX",
        60 * 30,  // 30 min TTL
    );
}

export async function getIndividualProgress(userId, profileId) {
    const key = `individual:progress:${userId}:${profileId}`;
    const data = await redisClient.get(key);

    if (!data) {
        return {
            stage: "PENDING",
            percent: 0,
            label: "Queued",
            updatedAt: null,
            error: null,
        };
    }

    try {
        return JSON.parse(data);
    } catch {
        return {
            stage: "PENDING",
            percent: 0,
            label: "Queued",
            updatedAt: null,
            error: null,
        };
    }
}