import { searchconsole_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
export declare const getAuth: (userId: string) => Promise<OAuth2Client | null>;
/**
 * Auto-detect the correct GSC verified site URL from Google's API.
 * Handles mismatches like DB having "https://test.open4all.in"
 * but GSC having "sc-domain:test.open4all.in" or "https://www.test.open4all.in/"
 *
 * Multi-user safe: caches per userId+siteUrl with 5-min TTL
 */
export declare const resolveGscSiteUrl: (dbSiteUrl: string, userId: string) => Promise<string>;
export declare const getGscOverview: (siteUrl: string, userId: string) => Promise<{
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
}>;
export declare const getGscKeywords: (siteUrl: string, userId: string, siteId?: string) => Promise<{
    keywords: {
        keyword: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }[];
}>;
export declare const getGscPages: (siteUrl: string, userId: string, siteId?: string) => Promise<{
    pages: {
        page: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }[];
}>;
export declare const getGscCountries: (siteUrl: string, userId: string) => Promise<{
    countries: {
        country: string;
        clicks: number;
        impressions: number;
        ctr: number;
    }[];
}>;
export declare const getGscDevices: (siteUrl: string, userId: string) => Promise<{
    devices: {
        device: string;
        clicks: number;
        impressions: number;
    }[];
}>;
export declare const getGscCoverage: (siteUrl: string, userId: string) => Promise<{
    indexed: number;
    submitted: number;
    crawledNotIndexed: number;
    discoveredNotIndexed: number;
    excluded: number;
}>;
export declare const getGscQuery: (siteUrl: string, userId: string, options: {
    startDate: string;
    endDate: string;
    dimensions: string[];
    rowLimit?: number;
    dimensionFilterGroups?: any[];
}) => Promise<{
    rows: searchconsole_v1.Schema$ApiDataRow[];
}>;
export declare const getGscSitemaps: (siteUrl: string, userId: string) => Promise<{
    sitemaps: searchconsole_v1.Schema$WmxSitemap[];
}>;
export declare const inspectUrl: (siteUrl: string, url: string, userId: string) => Promise<{
    inspectionResult: null;
} | {
    inspectionResult: searchconsole_v1.Schema$UrlInspectionResult | undefined;
}>;
export declare const getGscSites: (userId: string) => Promise<{
    siteEntry: searchconsole_v1.Schema$WmxSite[];
}>;
export declare const analyzeInsights: (siteUrl: string, userId: string) => Promise<{
    insights: string[];
}>;
//# sourceMappingURL=gsc.d.ts.map