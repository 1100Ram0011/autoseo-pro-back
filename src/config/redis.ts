import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Prevent multiple connections in development (similar to Prisma client)
const globalForRedis = global as unknown as { redis: Redis };

export const redis = globalForRedis.redis || new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    console.warn(`[Redis] Retrying connection (${times})...`);
    return Math.min(times * 50, 2000);
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

redis.on('error', (err) => {
  console.error('[Redis] Connection Error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

/**
 * Cache Wrapper utility function
 */
export const withCache = async <T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> => {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (error) {
    console.warn(`[Redis] Cache read failed for key ${key}`, error);
  }

  const data = await fetcher();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    console.warn(`[Redis] Cache write failed for key ${key}`, error);
  }

  return data;
};
