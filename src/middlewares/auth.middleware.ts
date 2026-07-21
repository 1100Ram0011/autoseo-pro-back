import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';

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
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Option 1: API Key authentication (for external integrations)
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      const user = await prisma.user.findUnique({
        where: { apiKey },
        select: { id: true, email: true, planId: true },
      });
      if (user) {
        (req as any).user = user;
        return next();
      }
      return res.status(401).json({ error: { message: 'Invalid API key', code: 'INVALID_API_KEY' } });
    }

    // Option 2: Email-based auth (from NextAuth session on frontend)
    const email = (req.headers['x-user-email'] as string) || (req.query.email as string);
    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, planId: true },
      });
      if (user) {
        (req as any).user = user;
        return next();
      }
      // If user doesn't exist yet, allow through for auto-creation flows
      (req as any).user = { email, id: null, planId: 'free' };
      return next();
    }

    // Option 3: No auth provided — allow through in dev mode for backward compat
    if (process.env.NODE_ENV !== 'production') {
      (req as any).user = { id: null, email: null, planId: 'free' };
      return next();
    }

    return res.status(401).json({ error: { message: 'Authentication required', code: 'AUTH_REQUIRED' } });
  } catch (error) {
    console.error('[Auth Middleware] Error:', error);
    return next();
  }
};
