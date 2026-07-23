import { Request, Response } from 'express';
export declare const syncProfile: (req: Request, res: Response) => Promise<void>;
export declare const getReviews: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const generateAiReply: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const publishReply: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=gmb.controller.d.ts.map