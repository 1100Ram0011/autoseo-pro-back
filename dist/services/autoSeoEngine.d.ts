import { EventEmitter } from 'events';
export declare const autoSeoEmitter: EventEmitter<any>;
export declare class AutoSeoEngine {
    private reportId;
    private siteId;
    private userId;
    private url;
    constructor(reportId: string, siteId: string, userId: string, url: string);
    private emit;
    private generateAiReport;
    runScan(): Promise<void>;
}
//# sourceMappingURL=autoSeoEngine.d.ts.map