import { Request, Response } from 'express';
export declare const getAnomalies: (req: Request, res: Response) => Promise<void>;
export declare const executeAction: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const triggerScan: (req: Request, res: Response) => Promise<void>;
//# sourceMappingURL=anomaly.controller.d.ts.map