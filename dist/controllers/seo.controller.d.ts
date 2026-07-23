import { Request, Response } from 'express';
export declare const submitIndexing: (req: Request, res: Response) => Promise<void>;
export declare const submitIndexingBatch: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getIndexingMetadata: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const verifyIndexing: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const runCrawl: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getSitemap: (req: Request, res: Response) => Promise<void>;
export declare const getRobotsTxt: (req: Request, res: Response) => Promise<void>;
export declare const getLlmsTxt: (req: Request, res: Response) => Promise<void>;
export declare const analyzePageSpeed: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getPageSpeedHistory: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const checkKnowledgeGraph: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const checkSafeBrowsing: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=seo.controller.d.ts.map