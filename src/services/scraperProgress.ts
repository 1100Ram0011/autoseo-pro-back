import { redis } from '../config/redis';

const RUNNING_TTL = 60 * 60;   // 1 hour
const FINISHED_TTL = 60 * 2;   // 2 minutes

function progressKey(userId: string) {
  return `progress:${userId}`;
}

function getTTL(event: string) {
  if (event === 'lead:completed' || event === 'lead:failed') return FINISHED_TTL;
  return RUNNING_TTL;
}

export const setLeadProgress = async ({
  userId,
  event,
  data = {} as any,
}: {
  userId: string;
  event: string;
  data?: Record<string, any>;
}) => {
  if (!userId) return;
  const payload = JSON.stringify({ event, data, updatedAt: Date.now() });
  try {
    await redis.set(progressKey(userId), payload, 'EX', getTTL(event));
  } catch (err: any) {
    console.error('[LeadProgress] setLeadProgress failed', err.message);
  }
};

export const getLeadProgress = async (userId: string) => {
  if (!userId) return null;
  try {
    const raw = await redis.get(progressKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearLeadProgress = async (userId: string) => {
  if (!userId) return;
  try {
    await redis.del(progressKey(userId));
  } catch (err: any) {
    console.error('[LeadProgress] clearLeadProgress failed', err.message);
  }
};
