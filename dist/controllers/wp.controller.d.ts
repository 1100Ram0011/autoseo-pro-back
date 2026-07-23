import { Request, Response } from 'express';
/**
 * Push AI-generated meta tags to WordPress via REST API
 * Assumes the WordPress site has Application Passwords enabled or uses a custom plugin.
 */
export declare const syncToWordPress: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=wp.controller.d.ts.map