import campaignRecipientLogSchema from "../../../models/Campaign/EmailCampaign/campaignRecipientLogSchema.js";
import campaignSchema from "../../../models/Campaign/EmailCampaign/campaignSchema.js";
import { emitCampaignUpdated } from "../../../utils/campaignSocketHelper.js";

// A 1x1 transparent GIF in Base64
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * GET /api/campaign/track/open/:logId
 * Tracks when an email is opened. Returns a transparent 1x1 GIF.
 */
export const trackOpen = async (req, res) => {
  try {
    const { logId } = req.params;

    if (!logId) {
      return res.status(400).send("Bad Request");
    }

    const log = await campaignRecipientLogSchema.findById(logId);
    if (!log) {
      return res.status(404).send("Not Found");
    }

    // Only count as an open if it hasn't been opened yet (Unique Opens)
    if (!log.openedAt) {
      log.openedAt = new Date();
      await log.save();

      // Increment campaign openedCount
      await campaignSchema.findByIdAndUpdate(log.campaignId, {
        $inc: { openedCount: 1 },
      });

      // Emit socket event to update dashboard
      emitCampaignUpdated(log.senderUserId, log.campaignId);
    }

    // Always return the 1x1 GIF
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": PIXEL.length,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(PIXEL);
  } catch (error) {
    console.error(`[Tracking] Error in trackOpen for log ${req.params?.logId}:`, error.message);
    // Even if it fails, try to serve the pixel so it doesn't break the email layout
    if (!res.headersSent) {
      res.writeHead(200, { "Content-Type": "image/gif" });
      res.end(PIXEL);
    }
  }
};

/**
 * GET /api/campaign/track/click/:logId
 * Tracks when a link is clicked. Requires ?url= encoded target URL.
 */
export const trackClick = async (req, res) => {
  try {
    const { logId } = req.params;
    let { url } = req.query;

    if (!logId || !url) {
      return res.status(400).send("Bad Request");
    }

    // Attempt to decode the URL safely
    try {
      url = decodeURIComponent(url);
    } catch (e) {
      // If decoding fails, leave it as is
    }

    const log = await campaignRecipientLogSchema.findById(logId);
    if (!log) {
      // If log not found, still redirect so the user doesn't hit a dead end
      return res.redirect(url);
    }

    // Only count as a click if it hasn't been clicked yet (Unique Clicks)
    if (!log.clickedAt) {
      log.clickedAt = new Date();
      
      // Also mark as opened if they clicked without loading images
      let isFirstOpen = false;
      if (!log.openedAt) {
        log.openedAt = new Date();
        isFirstOpen = true;
      }
      
      await log.save();

      const updateData = { $inc: { clickedCount: 1 } };
      if (isFirstOpen) {
        updateData.$inc.openedCount = 1;
      }

      // Increment campaign counts
      await campaignSchema.findByIdAndUpdate(log.campaignId, updateData);

      // Emit socket event to update dashboard
      emitCampaignUpdated(log.senderUserId, log.campaignId);
    }

    return res.redirect(url);
  } catch (error) {
    console.error(`[Tracking] Error in trackClick for log ${req.params?.logId}:`, error.message);
    // Always redirect on error to prevent breaking user experience
    const targetUrl = req.query?.url ? decodeURIComponent(req.query.url) : "/";
    return res.redirect(targetUrl);
  }
};
