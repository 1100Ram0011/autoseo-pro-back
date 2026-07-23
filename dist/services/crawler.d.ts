export declare function crawlSite(siteId: string, startUrl: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    url: string;
    siteId: string;
    indexed: boolean;
    indexingStatus: string;
    lastSubmittedAt: Date | null;
    lighthouse_data: string | null;
    last_audited: Date | null;
    psi_data: string | null;
}[]>;
//# sourceMappingURL=crawler.d.ts.map