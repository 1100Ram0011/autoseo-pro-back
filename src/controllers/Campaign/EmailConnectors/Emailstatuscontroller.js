import EmailToken from "../../../models/Campaign/EmailCampaign/emailTokenSchema.js";
import CampaignRecipientLog from "../../../models/Campaign/EmailCampaign/campaignRecipientLogSchema.js";
import EmailDailyUsageLog from "../../../models/Campaign/EmailCampaign/emailDailyUsageLogSchema.js";
import { detectEmailAccountInfo, getTierDailyLimit } from "../../../utils/emailTypeDetector.js";

/**
 * Returns which email providers the logged-in user has connected
 * along with their daily limits and usage counters.
 * GET /api/auth/status
 */
export const getConnectedAccounts = async (req, res) => {
    try {
        const tokens = await EmailToken.find({ userId: req.user.id, isActive: true }).select(
            "provider accountType tier email expiresAt createdAt isActive status metadata dailyLimit limitConfidence limitSource lifetimeSent lifetimeFailed"
        );

        // PRODUCTION: const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
        // TESTING: 2 minutes window for testing
        const ROLLING_WINDOW_MS = 2 * 60 * 1000;
        const twentyFourHoursAgo = new Date(Date.now() - ROLLING_WINDOW_MS);

        const accounts = await Promise.all(tokens.map(async (t) => {
            const sentInLast24h = await CampaignRecipientLog.countDocuments({
                senderTokenId: t._id,
                status: "sent",
                sentAt: { $gte: twentyFourHoursAgo }
            });

            const maxDailyLimit = t.metadata?.maxDailyLimit ?? getTierDailyLimit(t.tier || "unknown");
            const remainingToday = Math.max(0, t.dailyLimit ?? 0);
            const totalLifetime = (t.lifetimeSent || 0) + (t.lifetimeFailed || 0);
            const errorRate = totalLifetime > 0 ? parseFloat(((t.lifetimeFailed || 0) / totalLifetime * 100).toFixed(2)) : 0;
            const accountType = t.accountType || detectEmailAccountInfo(t.email, t.provider).accountType;

            return {
                id: t._id,
                provider: t.provider,
                accountType,
                tier: t.tier || "unknown",
                email: t.email,
                connectedAt: t.createdAt,
                tokenExpiresAt: t.expiresAt,
                isActive: t.isActive,
                status: t.status || (t.isActive ? "active" : "expired"),
                displayName: t.metadata?.displayName || t.metadata?.name || t.email,
                profilePicture: t.metadata?.picture || null,
                dailyLimit: maxDailyLimit,
                limitConfidence: t.limitConfidence || "low",
                limitSource: t.limitSource || "profile_detection",
                sentToday: sentInLast24h,
                remainingToday,
                lifetimeSent: t.lifetimeSent || 0,
                lifetimeFailed: t.lifetimeFailed || 0,
                errorRate,
            };
        }));

        res.json({
            success: true,
            connected: accounts,
            hasGoogle: accounts.some((a) => a.provider === "google"),
            hasMicrosoft: accounts.some((a) => a.provider === "microsoft"),
            hasCustom: accounts.some((a) => a.provider === "custom"),
        });
    } catch (err) {
        console.error("[Status] Error:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch status" });
    }
};

/**
 * Updates the daily send limit for a connected email account.
 * PUT /api/auth/email/limit
 */
export const updateEmailDailyLimit = async (req, res) => {
    try {
        const { email, dailyLimit } = req.body;
        const userId = req.user.id;

        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        if (dailyLimit === undefined || dailyLimit === null || isNaN(dailyLimit) || Number(dailyLimit) < 0) {
            return res.status(400).json({ success: false, message: "A valid positive number for dailyLimit is required" });
        }

        const token = await EmailToken.findOneAndUpdate(
            { userId, email: email.toLowerCase() },
            {
                $set: {
                    dailyLimit: Number(dailyLimit),
                    "metadata.maxDailyLimit": Number(dailyLimit),
                    limitSource: "manual_override",
                    limitConfidence: "high"
                }
            },
            { new: true }
        );

        if (!token) {
            return res.status(404).json({ success: false, message: "Email connection not found" });
        }

        return res.json({
            success: true,
            message: "Daily limit updated successfully",
            email: token.email,
            dailyLimit: token.dailyLimit,
        });
    } catch (err) {
        console.error("[Status] Update limit error:", err.message);
        res.status(500).json({ success: false, message: "Failed to update daily limit" });
    }
};

/**
 * Returns historical daily utilization log for an email connection.
 * GET /api/auth/email/utilization
 */
export const getEmailUtilizationHistory = async (req, res) => {
    try {
        const { email, days = 7 } = req.query;
        const userId = req.user.id;

        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const token = await EmailToken.findOne({ userId, email: email.toLowerCase() });
        if (!token) {
            return res.status(404).json({ success: false, message: "Email connection not found" });
        }

        const limitDays = parseInt(days, 10) || 7;
        const startDate = moment().utcOffset("+05:30").subtract(limitDays - 1, "days").format("YYYY-MM-DD");

        const logs = await EmailDailyUsageLog.find({
            tokenId: token._id,
            date: { $gte: startDate }
        }).sort({ date: 1 });

        const utilizationMap = new Map(logs.map(log => [log.date, log]));
        const result = [];

        for (let i = 0; i < limitDays; i++) {
            const dateStr = moment().utcOffset("+05:30").subtract(limitDays - 1 - i, "days").format("YYYY-MM-DD");
            const log = utilizationMap.get(dateStr);

            result.push({
                date: dateStr,
                sentCount: log ? log.sentCount : 0,
                failedCount: log ? log.failedCount : 0,
            });
        }

        return res.json({
            success: true,
            email: token.email,
            history: result,
        });
    } catch (err) {
        console.error("[Status] Fetch utilization history error:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch utilization history" });
    }
};