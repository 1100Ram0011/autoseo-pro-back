export declare const getGa4AccountsAndProperties: (auth: any) => Promise<import("googleapis").analyticsadmin_v1beta.Schema$GoogleAnalyticsAdminV1betaAccountSummary[]>;
export declare const getAnalyticsData: (propertyId: string, client: any, range?: string, customStart?: string | null, customEnd?: string | null) => Promise<{
    report: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    devices: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    countries: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    sources: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    pages: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    realtime: import("googleapis").analyticsdata_v1beta.Schema$RunRealtimeReportResponse;
    trend: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    newReturning: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    browsers: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    operatingSystems: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    landingPages: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    exitPages: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    conversions: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
    geoHierarchy: {
        rows: never[];
    };
}>;
export declare function formatAnalytics(data: any): {
    users: number;
    sessions: number;
    bounceRate: number;
    avgSessionDuration: number;
    pagesPerSession: number;
    engagedUsers: number;
    realtimeUsers: any;
    realtimeDetail: {
        byPage: {
            name: string;
            users: number;
        }[];
        byCountry: {
            name: string;
            users: number;
        }[];
        byCity: {
            name: string;
            users: number;
        }[];
        byDevice: {
            name: string;
            users: number;
        }[];
    };
    countries: any;
    devices: any;
    trafficSources: any;
    topPages: any;
    landingPages: any;
    exitPages: any;
    trend: any;
    newReturning: {
        new: number;
        returning: number;
    };
    browsers: any;
    operatingSystems: any;
    conversions: any;
    geoTree: any;
    cities: any;
    regions: any;
};
export declare const getGa4Overview: (propertyId: string, userId: string) => Promise<{
    metrics: {
        activeUsers: number;
        activeUsersChange: number;
    };
    trend: never[];
} | {
    metrics: {
        activeUsers: any;
        activeUsersChange: number;
    };
    trend: import("googleapis").analyticsdata_v1beta.Schema$RunReportResponse;
}>;
//# sourceMappingURL=ga4.d.ts.map