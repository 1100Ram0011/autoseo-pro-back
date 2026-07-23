"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
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
const authMiddleware = async (req, res, next) => {
    try {
        // Option 1: API Key authentication (for external integrations)
        const apiKey = req.headers['x-api-key'];
        if (apiKey) {
            const user = await prisma_1.default.user.findUnique({
                where: { apiKey },
                select: { id: true, email: true, planId: true },
            });
            if (user) {
                req.user = user;
                return next();
            }
            return res.status(401).json({ error: { message: 'Invalid API key', code: 'INVALID_API_KEY' } });
        }
        // Option 2: Email-based auth (from NextAuth session on frontend)
        const email = req.headers['x-user-email'] || req.query.email;
        if (email) {
            const user = await prisma_1.default.user.findUnique({
                where: { email },
                select: { id: true, email: true, planId: true },
            });
            if (user) {
                req.user = user;
                return next();
            }
            // If user doesn't exist yet, allow through for auto-creation flows
            req.user = { email, id: null, planId: 'free' };
            return next();
        }
        // Option 3: No auth provided — allow through in dev mode for backward compat
        if (process.env.NODE_ENV !== 'production') {
            req.user = { id: null, email: null, planId: 'free' };
            return next();
        }
        return res.status(401).json({ error: { message: 'Authentication required', code: 'AUTH_REQUIRED' } });
    }
    catch (error) {
        console.error('[Auth Middleware] Error:', error);
        return next();
    }
};
exports.authMiddleware = authMiddleware;
//# sourceMappingURL=auth.middleware.js.map