import { Request, Response } from 'express';
export declare const startScan: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const streamProgress: (req: Request, res: Response) => void;
export declare const getReport: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=autoseo.controller.d.ts.map