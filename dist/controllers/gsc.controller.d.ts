import { Request, Response } from 'express';
export declare const getOverview: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getKeywords: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getPages: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getCoverage: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getCountries: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getDevices: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getQuery: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getSitemaps: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const inspectUrlEndpoint: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getInsights: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getSitesList: (req: Request, res: Response) => Promise<void>;
export declare const getFullSeoGsc: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=gsc.controller.d.ts.map