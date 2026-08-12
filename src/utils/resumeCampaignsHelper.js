import Campaign from "../models/Campaign/EmailCampaign/campaignSchema.js";
import CampaignRecipientLog from "../models/Campaign/EmailCampaign/campaignRecipientLogSchema.js";
import { agenda } from "../jobs/agenda/agenda.js";
import { EMAIL_CAMPAIGN_DISPATCHER_JOB } from "../jobs/emailCampaignDispatcher.job.js";
import logger from "../config/logger.js";

/**
 * Automatically unpauses campaigns for a user that are currently waiting
 * due to exhausted daily limits or having no active connected email accounts.
 * Triggered typically when a user successfully connects a new email account.
 * 
 * @param {string} userId - The ID of the user whose campaigns should be checked.
 */
export const autoResumePausedCampaigns = async (userId) => {
    try {
        if (!userId) return;

        // Find campaigns that are paused and waiting on email accounts or limits
        const pausedCampaigns = await Campaign.find(
            {
                userId,
                status: "paused",
                holdReason: { $regex: /daily (limit|sending)|no active connected/i },
            },
            { _id: 1, name: 1 }
        );

        if (pausedCampaigns.length > 0) {
            const campaignIds = pausedCampaigns.map((c) => c._id);

            logger.info(`[Auto-Resume] Found ${pausedCampaigns.length} paused campaigns for user ${userId} waiting for capacity.`);

            // Unpause campaigns
            await Campaign.updateMany(
                { _id: { $in: campaignIds } },
                {
                    $set: { status: "queued" },
                    $unset: { holdReason: 1, resumeAt: 1 },
                }
            );

            // Unpause their scheduled logs
            await CampaignRecipientLog.updateMany(
                { campaignId: { $in: campaignIds }, status: "scheduled" },
                {
                    $set: { status: "queued" },
                    $unset: { errorReason: 1 },
                }
            );

            // Schedule the dispatcher to run shortly and process these newly unpaused campaigns
            const dispatchDelay = new Date(Date.now() + 5000); // 5 second delay
            await agenda.schedule(dispatchDelay, EMAIL_CAMPAIGN_DISPATCHER_JOB);

            logger.info(`[Auto-Resume] Unpaused campaigns: ${pausedCampaigns.map(c => c.name).join(", ")}. Dispatcher scheduled in 5s.`);
        }
    } catch (error) {
        logger.error(`[Auto-Resume] Failed to auto-resume campaigns for user ${userId}: ${error.message}`);
    }
};
