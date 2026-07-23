"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiLimiter = exports.crawlLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = __importDefault(require("rate-limit-redis"));
const redis_1 = require("../config/redis");
// Note: Requires req.user to be set by authMiddleware before this limiter is called
const keyGenerator = (req) => {
    return req.user ? req.user.id : 'anonymous';
};
exports.crawlLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: (req) => {
        // Dynamic max based on user plan
        // In production, req.user.plan would determine this
        if (req.user?.plan === 'AGENCY')
            return 1000;
        if (req.user?.plan === 'PRO')
            return 50;
        return 5; // Free tier
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    store: new rate_limit_redis_1.default({
        // @ts-ignore - ioredis typing mismatch with rate-limit-redis
        sendCommand: (...args) => redis_1.redis.call(...args),
    }),
    message: { error: 'Too many crawls from this account, please upgrade to PRO or try again after an hour' }
});
exports.aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req) => {
        if (req.user?.plan === 'AGENCY')
            return 500;
        if (req.user?.plan === 'PRO')
            return 100;
        return 10;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    store: new rate_limit_redis_1.default({
        // @ts-ignore - ioredis typing mismatch with rate-limit-redis
        sendCommand: (...args) => redis_1.redis.call(...args),
    }),
    message: { error: 'Too many AI requests from this account, please try again later' }
});
//# sourceMappingURL=rateLimit.js.map