import { Request, Response } from 'express';
export declare const oauth2Client: import("googleapis-common").OAuth2Client;
export declare const googleAuth: (req: Request, res: Response) => Response<any, Record<string, any>> | undefined;
export declare const googleAuthCallback: (req: Request, res: Response) => Promise<void>;
export declare const checkGoogleAuthStatus: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getGoogleProperties: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getGscProperties: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=auth.controller.d.ts.map