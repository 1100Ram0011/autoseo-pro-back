export declare const fetchLeadsWithGemini: (targetMarket: string, geographicFocus: string, limit?: number) => Promise<any[]>;
export declare const suggestTargetMarketsFromGemini: (businessName: string, industry: string, businessDescription: string, input: string) => Promise<any[]>;
export declare const validateTargetMarketWithGemini: (businessName: string, industry: string, businessDescription: string, targetMarket: string) => Promise<{
    isValid: any;
    reason: any;
}>;
//# sourceMappingURL=geminiLeadEngine.d.ts.map