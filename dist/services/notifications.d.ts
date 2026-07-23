export interface NotificationPayload {
    siteId: string;
    type: 'CRITICAL_ANOMALY' | 'SEO_REPORT_READY' | 'KEYWORD_DROP' | 'TRAFFIC_SPIKE';
    title: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
}
export declare class NotificationService {
    /**
     * Main entry point for dispatching notifications
     */
    static dispatch(payload: NotificationPayload): Promise<void>;
    private static saveInAppNotification;
    private static sendEmail;
    private static sendWebhook;
}
//# sourceMappingURL=notifications.d.ts.map