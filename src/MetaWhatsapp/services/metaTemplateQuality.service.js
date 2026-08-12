import MetaWhatsappTemplate from "../models/metaWhatsappCampaignTemplateSchema.js";

class MetaTemplateQualityService {
  /**
   * Handle incoming webhook for template status update
   */
  async handleStatusUpdate(payload) {
    try {
      const {
        message_template_id,
        message_template_name,
        event,
        reason,
        disable_info,
      } = payload;

      // Meta webhooks often send the name, but sometimes ID. We check both.
      let query = {};
      if (message_template_id) {
        query = { metaTemplateId: String(message_template_id) };
      } else if (message_template_name) {
        query = { name: message_template_name };
      } else {
        return; // Nothing to identify template
      }

      const template = await MetaWhatsappTemplate.findOne(query);
      if (!template) return; // Template not tracked locally

      const historyEntry = {
        event,
        reason,
        timestamp: new Date(),
      };

      if (event === "PAUSED") {
        template.isPaused = true;
        template.status = "PAUSED";
        template.pauseCount += 1;

        // Calculate pause duration based on count (Meta standard)
        // 1st pause: 3h, 2nd: 6h
        historyEntry.pauseDuration = template.pauseCount === 1 ? 3 : 6;
        historyEntry.autoResumedAt = new Date(
          Date.now() + historyEntry.pauseDuration * 60 * 60 * 1000,
        );
      } else if (event === "DISABLED") {
        template.isPaused = false;
        template.isDisabledByMeta = true;
        template.status = "DISABLED";
        template.disabledAt = disable_info?.disable_date
          ? new Date(disable_info.disable_date)
          : new Date();
      } else if (event === "APPROVED" || event === "UNFLAGGED") {
        template.isPaused = false;
        template.isDisabledByMeta = false;
        template.status = "APPROVED";
      } else if (event === "FLAGGED") {
        template.qualityScore = "RED"; // Usually correlates with being flagged
      }

      template.qualityHistory.push(historyEntry);
      await template.save();

      // Optional: trigger notifications to users if configured in number schema
      // (Skipped direct implementation here to keep it modular, would ideally emit an event)
    } catch (error) {
      console.error("[TemplateQuality] Error handling status update:", error);
    }
  }
}

export default new MetaTemplateQualityService();
