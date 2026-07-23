import Redis from 'ioredis';
export declare const redis: Redis;
/**
 * Cache Wrapper utility function
 */
export declare const withCache: <T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>;
//# sourceMappingURL=redis.d.ts.map