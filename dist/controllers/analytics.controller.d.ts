import { Request, Response } from 'express';
export declare const getGa4Overview: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getGa4Pages: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getAnalytics: (req: Request, res: Response) => Promise<void>;
export declare const trackVisitor: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=analytics.controller.d.ts.map