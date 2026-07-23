export interface ABTestConfig {
    siteId: string;
    pageUrl: string;
    targetKeyword: string;
}
export declare class ABTestingService {
    /**
     * Initializes an A/B test for a specific page's meta tags.
     */
    static startTest(config: ABTestConfig): Promise<{
        status: string;
        page: string;
        variations: {
            id: string;
            title: string;
            description: string;
        }[];
        currentActive: string;
    }>;
    /**
     * Evaluates ongoing A/B tests to see if a statistical winner has emerged.
     * This would typically run in a daily cron job.
     */
    static evaluateTests(): Promise<void>;
    private static generateVariations;
    private static pushVariation;
}
//# sourceMappingURL=abTesting.d.ts.map