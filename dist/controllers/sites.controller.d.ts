import { Request, Response } from 'express';
export declare const getSites: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const addSite: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getSitePages: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const updateSiteSettings: (req: Request, res: Response) => Promise<void>;
export declare const autoDetectGscProperty: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const autoDetectGa4Property: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=sites.controller.d.ts.map