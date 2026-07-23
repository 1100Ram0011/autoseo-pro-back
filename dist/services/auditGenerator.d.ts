interface LeadData {
    name: string;
    url: string;
    email: string;
}
export declare class AutonomousLocalBusinessCloser {
    extractData(location: string, industry: string): Promise<LeadData[]>;
    runLiveAudit(url: string): Promise<{
        score: number;
        issues: string[];
    }>;
    generateDynamicPDF(lead: LeadData, auditData: any): Promise<Buffer<ArrayBuffer>>;
    autonomousOutreach(lead: LeadData, pdfBuffer: Buffer, auditData: any): Promise<boolean>;
    executePipeline(location: string, industry: string): Promise<{
        success: boolean;
        leadsProcessed: number;
    }>;
}
export {};
//# sourceMappingURL=auditGenerator.d.ts.map