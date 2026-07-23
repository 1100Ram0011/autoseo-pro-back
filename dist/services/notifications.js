"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = __importDefault(require("../config/prisma"));
class NotificationService {
    /**
     * Main entry point for dispatching notifications
     */
    static async dispatch(payload) {
        try {
            // 1. Save to database for in-app notification center
            await this.saveInAppNotification(payload);
            // 2. Fetch site settings to determine which external channels are active
            const site = await prisma_1.default.site.findUnique({
                where: { id: payload.siteId },
                include: { user: true }
            });
            if (!site)
                return;
            // 3. Send Email for high/critical severity
            if (payload.severity === 'high' || payload.severity === 'critical') {
                await this.sendEmail(site.user.email, payload);
            }
            // 4. Send Webhook if configured (e.g., Slack/Discord)
            // Note: Assuming a hypothetical webhookUrl exists in Site or User settings
            // if (site.webhookUrl) {
            //   await this.sendWebhook(site.webhookUrl, payload);
            // }
        }
        catch (error) {
            console.error('Failed to dispatch notification', error);
        }
    }
    static async saveInAppNotification(payload) {
        // Requires a Notification model in Prisma.
        // For now, if the model doesn't exist, we log it.
        console.log(`[IN-APP NOTIFICATION] ${payload.title}: ${payload.message}`);
        // await prisma.notification.create({ data: { ...payload } });
    }
    static async sendEmail(email, payload) {
        // Integration with Resend / SendGrid
        console.log(`[EMAIL DISPATCH] To: ${email} | Subject: ${payload.title}`);
    }
    static async sendWebhook(url, payload) {
        try {
            await axios_1.default.post(url, {
                text: `*${payload.title}*\n${payload.message}`,
                severity: payload.severity
            });
            console.log(`[WEBHOOK DISPATCH] Sent to ${url}`);
        }
        catch (e) {
            console.error(`[WEBHOOK DISPATCH] Failed for ${url}`, e);
        }
    }
}
exports.NotificationService = NotificationService;
//# sourceMappingURL=notifications.js.map