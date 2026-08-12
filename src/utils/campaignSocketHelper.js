import redisClient from "../config/redis.js";

export const emitCampaignUpdated = async (userId, campaignId) => {
  try {
    if (!userId || !campaignId) return;
    const socketPayload = JSON.stringify({
      userId: userId.toString(),
      event: "campaign:updated",
      data: { campaignId: campaignId.toString() },
    });
    await redisClient.publish("socket:user", socketPayload);
    console.log(`[SocketHelper] Published campaign:updated for user ${userId}, campaign ${campaignId}`);
  } catch (error) {
    console.error("[SocketHelper] Failed to publish campaign update:", error.message);
  }
};
