/**
 * Mock Data Utility
 * Centralized mock data generation for when APIs are not connected.
 * All mock data generators live here instead of being scattered across services.
 */
export declare const isMockMode: () => boolean;
export declare const isGoogleConnected: (refreshToken: string | null | undefined) => boolean;
export declare const MOCK_GSC: {
    overview: {
        metrics: {
            clicks: number;
            clicksChange: number;
            impressions: number;
            impressionsChange: number;
            ctr: number;
            ctrChange: number;
            position: number;
            positionChange: number;
            indexed: number;
            indexedChange: number;
            notIndexed: number;
            notIndexedChange: number;
        };
        trend: {
            date: string | undefined;
            clicks: number;
            impressions: number;
        }[];
    };
    keywords: {
        keywords: {
            keyword: string;
            clicks: number;
            impressions: number;
            ctr: number;
            position: number;
        }[];
    };
    pages: {
        pages: {
            page: string;
            clicks: number;
            impressions: number;
            ctr: number;
            position: number;
        }[];
    };
    coverage: {
        indexed: number;
        submitted: number;
        crawledNotIndexed: number;
        discoveredNotIndexed: number;
        excluded: number;
    };
    devices: {
        devices: {
            device: string;
            clicks: number;
            impressions: number;
        }[];
    };
};
export declare const MOCK_GA4: {
    overview: {
        metrics: {
            activeUsers: number;
            activeUsersChange: number;
        };
        trend: never[];
    };
};
export declare const generateMockPageSpeed: (url: string, strategy: "mobile" | "desktop") => {
    strategy: "mobile" | "desktop";
    url: string;
    fetchTime: string;
    scores: {
        performance: number;
        accessibility: number;
        bestPractices: number;
        seo: number;
    };
    coreWebVitals: {
        lab: {
            lcp: {
                value: number;
                displayValue: string;
                rating: string;
            };
            fcp: {
                value: number;
                displayValue: string;
                rating: string;
            };
            cls: {
                value: number;
                displayValue: string;
                rating: string;
            };
            tbt: {
                value: number;
                displayValue: string;
            };
            speedIndex: {
                value: number;
                displayValue: string;
            };
            ttfb: {
                value: number;
                displayValue: string;
                rating: string;
            };
        };
        field: null;
        originField: null;
    };
    opportunities: {
        id: string;
        title: string;
        description: string;
        wastedBytes: number;
        wastedMs: number;
        items: {
            url: string;
            totalBytes: number;
            wastedBytes: number;
        }[];
    }[];
    diagnostics: {
        domSize: {
            value: number;
            details: never[];
        };
        mainThread: never[];
        networkRequests: never[];
        networkRtt: number;
        thirdParty: never[];
        longTasks: never[];
        resourceSummary: never[];
    };
    audits: {
        seo: never[];
        accessibility: never[];
        bestPractices: never[];
    };
    screenshots: {
        final: null;
        filmstrip: never[];
    };
};
export declare const MOCK_AI: {
    analysis: (siteUrl: string) => {
        overallHealthScore: number;
        summary: string;
        keyFindings: {
            title: string;
            description: string;
        }[];
        actionPlan: {
            task: string;
            priority: string;
            impact: string;
        }[];
    };
    keywords: (topic: string) => {
        keyword: string;
        volume: number;
        difficulty: string;
    }[];
    blogPost: (keyword: string) => string;
    schema: (topic: string) => {
        "@context": string;
        "@type": string;
        mainEntity: {
            "@type": string;
            name: string;
            acceptedAnswer: {
                "@type": string;
                text: string;
            };
        }[];
    };
    anomalies: {
        type: string;
        description: string;
        severity: string;
        actions: {
            task: string;
            impact: string;
        }[];
    }[];
};
export declare const generateMockClarityData: (siteUrl: string) => any[];
//# sourceMappingURL=mockData.d.ts.map