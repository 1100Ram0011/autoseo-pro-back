import logger from "../../config/logger.js";
import MetaGraphClient from "./metaFbWhatsapp.client.js";
import MetaWhatsappAnalytics from "../models/metaWhatsappAnalyticsSchema.js";

// ─── FETCH CONVERSATION ANALYTICS ─────────────────────────────────────────────

/**
 * Fetch conversation analytics from Meta Graph API.
 * GET /{WABA-ID}?fields=conversation_analytics.start().end().granularity().dimensions()
 */
export const fetchConversationAnalytics = async (wabaId, accessToken, start, end, granularity = "DAILY") => {
    try {
        const startTs = Math.floor(new Date(start).getTime() / 1000);
        const endTs = Math.floor(new Date(end).getTime() / 1000);

        const data = await MetaGraphClient.getConversationAnalytics(
            wabaId, accessToken, startTs, endTs, granularity,
            ["CONVERSATION_CATEGORY", "CONVERSATION_TYPE", "CONVERSATION_DIRECTION", "COUNTRY", "PHONE"]
        );

        return data;
    } catch (err) {
        logger.error(`[AnalyticsService] Failed to fetch conversation analytics: ${err.message}`);
        throw err;
    }
};

// ─── FETCH MESSAGE ANALYTICS ──────────────────────────────────────────────────

/**
 * Fetch message-level analytics from Meta Graph API.
 * GET /{WABA-ID}?fields=analytics.start().end().granularity()
 */
export const fetchMessageAnalytics = async (wabaId, accessToken, start, end, granularity = "DAILY") => {
    try {
        const startTs = Math.floor(new Date(start).getTime() / 1000);
        const endTs = Math.floor(new Date(end).getTime() / 1000);

        const data = await MetaGraphClient.getMessageAnalytics(
            wabaId, accessToken, startTs, endTs, granularity
        );

        return data;
    } catch (err) {
        logger.error(`[AnalyticsService] Failed to fetch message analytics: ${err.message}`);
        throw err;
    }
};

// ─── SYNC & CACHE ANALYTICS ──────────────────────────────────────────────────

/**
 * Fetch analytics from Meta and cache in the database.
 * Returns cached data if fresh (< 6 hours old), otherwise fetches new data.
 */
export const syncAndCacheAnalytics = async (userId, wabaId, accessToken, start, end, granularity = "DAILY", forceRefresh = false) => {
    const results = {};

    // ── Conversation Analytics ─────────────────────────────────────────────
    try {
        if (!forceRefresh) {
            const cached = await MetaWhatsappAnalytics.isFresh(userId, wabaId, "conversation_analytics", new Date(start), new Date(end));
            if (cached) {
                results.conversationAnalytics = cached;
            }
        }

        if (!results.conversationAnalytics) {
            const data = await fetchConversationAnalytics(wabaId, accessToken, start, end, granularity);

            // Parse summary from data points
            let totalConversations = 0;
            let freeConversations = 0;
            let paidConversations = 0;

            if (data?.conversation_analytics?.data?.[0]?.data_points) {
                for (const dp of data.conversation_analytics.data[0].data_points) {
                    totalConversations += dp.conversation || 0;
                    if (dp.conversation_type === "FREE_ENTRY_POINT" || dp.conversation_type === "FREE_TIER") {
                        freeConversations += dp.conversation || 0;
                    } else {
                        paidConversations += dp.conversation || 0;
                    }
                }
            }

            results.conversationAnalytics = await MetaWhatsappAnalytics.findOneAndUpdate(
                { userId, wabaId, type: "conversation_analytics", periodStart: new Date(start), periodEnd: new Date(end) },
                {
                    granularity,
                    data,
                    summary: { totalConversations, freeConversations, paidConversations },
                    fetchedAt: new Date(),
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            logger.info(`[AnalyticsService] Cached conversation analytics for WABA ${wabaId}`);
        }
    } catch (err) {
        logger.error(`[AnalyticsService] Conversation analytics sync failed: ${err.message}`);
        results.conversationAnalyticsError = err.message;
    }

    // ── Message Analytics ──────────────────────────────────────────────────
    try {
        if (!forceRefresh) {
            const cached = await MetaWhatsappAnalytics.isFresh(userId, wabaId, "message_analytics", new Date(start), new Date(end));
            if (cached) {
                results.messageAnalytics = cached;
            }
        }

        if (!results.messageAnalytics) {
            const data = await fetchMessageAnalytics(wabaId, accessToken, start, end, granularity);

            let messageSent = 0;
            let messageDelivered = 0;

            if (data?.analytics?.data?.[0]?.data_points) {
                for (const dp of data.analytics.data[0].data_points) {
                    messageSent += dp.sent || 0;
                    messageDelivered += dp.delivered || 0;
                }
            }

            results.messageAnalytics = await MetaWhatsappAnalytics.findOneAndUpdate(
                { userId, wabaId, type: "message_analytics", periodStart: new Date(start), periodEnd: new Date(end) },
                {
                    granularity,
                    data,
                    summary: { messageSent, messageDelivered },
                    fetchedAt: new Date(),
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            logger.info(`[AnalyticsService] Cached message analytics for WABA ${wabaId}`);
        }
    } catch (err) {
        logger.error(`[AnalyticsService] Message analytics sync failed: ${err.message}`);
        results.messageAnalyticsError = err.message;
    }

    return results;
};

export default {
    fetchConversationAnalytics,
    fetchMessageAnalytics,
    syncAndCacheAnalytics,
};
