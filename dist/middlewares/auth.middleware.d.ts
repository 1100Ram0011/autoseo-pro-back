import { Request, Response, NextFunction } from 'express';
/**
 * Auth Middleware
 * Verifies that the request includes a valid user email or API key.
 * In production, this should validate JWT tokens from NextAuth.
 *
 * For now, it checks:
 * 1. x-api-key header (for WordPress plugin / external integrations)
 * 2. x-user-email header (for frontend requests — sent by NextAuth session)
 * 3. email query parameter (backward compatibility)
 */
export declare const authMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
//# sourceMappingURL=auth.middleware.d.ts.map