import { Request, Response } from 'express';
export declare const scanBacklinks: (req: Request, res: Response) => Promise<void>;
export declare const getBacklinks: (req: Request, res: Response) => Promise<void>;
export declare const markDisavow: (req: Request, res: Response) => Promise<void>;
export declare const generateDisavow: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=backlinks.controller.d.ts.map