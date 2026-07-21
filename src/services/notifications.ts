import axios from 'axios';
import prisma from '../config/prisma';

export interface NotificationPayload {
  siteId: string;
  type: 'CRITICAL_ANOMALY' | 'SEO_REPORT_READY' | 'KEYWORD_DROP' | 'TRAFFIC_SPIKE';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class NotificationService {
  /**
   * Main entry point for dispatching notifications
   */
  public static async dispatch(payload: NotificationPayload) {
    try {
      // 1. Save to database for in-app notification center
      await this.saveInAppNotification(payload);

      // 2. Fetch site settings to determine which external channels are active
      const site = await prisma.site.findUnique({
        where: { id: payload.siteId },
        include: { user: true }
      });

      if (!site) return;

      // 3. Send Email for high/critical severity
      if (payload.severity === 'high' || payload.severity === 'critical') {
        await this.sendEmail(site.user.email, payload);
      }

      // 4. Send Webhook if configured (e.g., Slack/Discord)
      // Note: Assuming a hypothetical webhookUrl exists in Site or User settings
      // if (site.webhookUrl) {
      //   await this.sendWebhook(site.webhookUrl, payload);
      // }
    } catch (error) {
      console.error('Failed to dispatch notification', error);
    }
  }

  private static async saveInAppNotification(payload: NotificationPayload) {
    // Requires a Notification model in Prisma.
    // For now, if the model doesn't exist, we log it.
    console.log(`[IN-APP NOTIFICATION] ${payload.title}: ${payload.message}`);
    // await prisma.notification.create({ data: { ...payload } });
  }

  private static async sendEmail(email: string, payload: NotificationPayload) {
    // Integration with Resend / SendGrid
    console.log(`[EMAIL DISPATCH] To: ${email} | Subject: ${payload.title}`);
  }

  private static async sendWebhook(url: string, payload: NotificationPayload) {
    try {
      await axios.post(url, {
        text: `*${payload.title}*\n${payload.message}`,
        severity: payload.severity
      });
      console.log(`[WEBHOOK DISPATCH] Sent to ${url}`);
    } catch (e) {
      console.error(`[WEBHOOK DISPATCH] Failed for ${url}`, e);
    }
  }
}
