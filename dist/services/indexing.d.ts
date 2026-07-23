export declare const submitUrl: (url: string, type?: "URL_UPDATED" | "URL_DELETED") => Promise<import("googleapis").indexing_v3.Schema$PublishUrlNotificationResponse>;
export declare const getMetadata: (url: string) => Promise<import("googleapis").indexing_v3.Schema$UrlNotificationMetadata | null>;
export declare const submitBatch: (urls: string[], type?: "URL_UPDATED" | "URL_DELETED") => Promise<{
    successful: any[];
    failed: any[];
}>;
//# sourceMappingURL=indexing.d.ts.map