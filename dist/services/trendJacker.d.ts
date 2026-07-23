export declare class AiTrendJacker {
    private ai;
    constructor();
    scanTrends(): Promise<string[]>;
    generateContent(topic: string): Promise<any>;
    dispatchContent(siteId: string, contentData: any): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        siteId: string;
        title: string;
        content: string;
        posted_platforms: string | null;
    }>;
    executePipeline(siteId: string): Promise<{
        success: boolean;
        processedTrends: number;
        drafts: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            siteId: string;
            title: string;
            content: string;
            posted_platforms: string | null;
        }[];
    }>;
}
//# sourceMappingURL=trendJacker.d.ts.map