import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';

// Note: Requires req.user to be set by authMiddleware before this limiter is called
const keyGenerator = (req: any) => {
  return req.user ? req.user.id : 'anonymous';
};

export const crawlLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: (req: any) => {
    // Dynamic max based on user plan
    // In production, req.user.plan would determine this
    if (req.user?.plan === 'AGENCY') return 1000;
    if (req.user?.plan === 'PRO') return 50;
    return 5; // Free tier
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  store: new RedisStore({
    // @ts-ignore - ioredis typing mismatch with rate-limit-redis
    sendCommand: (...args: string[]) => redis.call(...args),
  }),
  message: { error: 'Too many crawls from this account, please upgrade to PRO or try again after an hour' }
});

export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req: any) => {
    if (req.user?.plan === 'AGENCY') return 500;
    if (req.user?.plan === 'PRO') return 100;
    return 10;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  store: new RedisStore({
    // @ts-ignore - ioredis typing mismatch with rate-limit-redis
    sendCommand: (...args: string[]) => redis.call(...args),
  }),
  message: { error: 'Too many AI requests from this account, please try again later' }
});
