"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCache = exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Prevent multiple connections in development (similar to Prisma client)
const globalForRedis = global;
exports.redis = globalForRedis.redis || new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        console.warn(`[Redis] Retrying connection (${times})...`);
        return Math.min(times * 50, 2000);
    }
});
if (process.env.NODE_ENV !== 'production') {
    globalForRedis.redis = exports.redis;
}
exports.redis.on('error', (err) => {
    console.error('[Redis] Connection Error:', err.message);
});
exports.redis.on('connect', () => {
    console.log('[Redis] Connected successfully');
});
/**
 * Cache Wrapper utility function
 */
const withCache = async (key, ttlSeconds, fetcher) => {
    try {
        const cached = await exports.redis.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
    }
    catch (error) {
        console.warn(`[Redis] Cache read failed for key ${key}`, error);
    }
    const data = await fetcher();
    try {
        await exports.redis.setex(key, ttlSeconds, JSON.stringify(data));
    }
    catch (error) {
        console.warn(`[Redis] Cache write failed for key ${key}`, error);
    }
    return data;
};
exports.withCache = withCache;
//# sourceMappingURL=redis.js.map