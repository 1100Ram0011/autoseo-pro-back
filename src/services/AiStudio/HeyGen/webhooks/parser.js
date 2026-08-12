/**
 * HeyGen Webhook Parser Utility
 */

export const parseWebhookPayload = (body) => {
  const payload = typeof body === "string" ? JSON.parse(body) : body;

  const eventType = payload.event_type || payload.event || payload.type || "unknown";
  const eventData = payload.event_data || payload.data || payload;
  const videoId = eventData.video_id || eventData.id || null;
  const status = eventData.status || (eventType.includes("success") ? "completed" : eventType.includes("failed") ? "failed" : "unknown");

  return {
    eventType,
    videoId,
    status,
    raw: payload,
    data: eventData,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
};

export default { parseWebhookPayload };
