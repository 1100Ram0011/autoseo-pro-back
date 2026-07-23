export declare class SecureHardwarePurgeEngine {
    flushSessionMemory(userId: string): Promise<number>;
    enforceZeroState(): Promise<boolean>;
    executePurge(userId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
//# sourceMappingURL=securePurge.d.ts.map