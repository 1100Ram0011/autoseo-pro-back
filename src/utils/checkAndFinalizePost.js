

import SocialPost from "../models/SocialPost.js";
import logger from "../config/logger.js";

export const checkAndFinalizePost = async (socialPostId) => {
  try {
    if (!socialPostId) {
      logger.warn("checkAndFinalizePost: no socialPostId provided");
      return;
    }

    const post = await SocialPost.findById(socialPostId).lean();

    console.log(post , "0000000000000000")
    if (!post) {
      logger.warn("checkAndFinalizePost: post not found", { socialPostId });
      return;
    }

    const platforms = post.platforms || [];

    logger.info("checkAndFinalizePost: checking platforms", {
      socialPostId,
      currentStatus: post.status,
      platformStatuses: platforms.map((p) => ({
        platform : p.platform,
        accountId: p.accountId,
        status   : p.result?.status,
      })),
    });

    // If no platforms, nothing to check
    if (platforms.length === 0) return;

    const allDone = platforms.every((p) =>
      ["PUBLISHED", "FAILED"].includes(p.result?.status)
    );


    console.log(allDone , "1111111111111111")

    if (!allDone) {
      logger.info("checkAndFinalizePost: not all platforms done yet — waiting", {
        socialPostId,
        pending: platforms
          .filter((p) => !["PUBLISHED", "FAILED"].includes(p.result?.status))
          .map((p) => ({ platform: p.platform, status: p.result?.status })),
      });
      return;
    }

    const allFailed  = platforms.every((p) => p.result?.status === "FAILED");
    const finalStatus = allFailed ? "FAILED" : "COMPLETED";

    // Only update if not already in final state (avoids redundant writes)
    if (["COMPLETED", "FAILED"].includes(post.status)) {
      logger.info("checkAndFinalizePost: post already finalized", {
        socialPostId,
        status: post.status,
      });
      return;
    }

    const result = await SocialPost.findByIdAndUpdate(
      socialPostId,
      { $set: { status: finalStatus } },
      { new: true }
    );

    console.log(result , "2222222222222222222222")

    logger.info("checkAndFinalizePost: post finalized ✅", {
      socialPostId,
      finalStatus,
      updatedStatus: result?.status,
    });
  } catch (err) {
    logger.error("checkAndFinalizePost: error", {
      socialPostId,
      error: err.message,
      stack: err.stack,
    });
  }
};