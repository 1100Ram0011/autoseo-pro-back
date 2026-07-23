import { Request, Response } from 'express';
export declare const getSmartAlerts: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getAlerts: (req: Request, res: Response) => Promise<void>;
export declare const markAsRead: (req: Request, res: Response) => Promise<void>;
export declare const simulateUptimeCheck: (req: Request, res: Response) => Promise<void>;
//# sourceMappingURL=alerts.controller.d.ts.map