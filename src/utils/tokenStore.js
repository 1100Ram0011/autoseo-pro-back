import redisClient from "../config/redis.js";
import config from "../config/config.js";


// Ensure TTL logic handles the config value correctly (ms -> seconds)
const REFRESH_TTL = Math.floor(
  (parseInt(config.REFRESH_TOKEN_MAX_AGE) || 86400000) / 1000,
);

export const storeRefreshToken = async (userId, token) => {
  const key = `refresh_token:${userId}:${token}`;
  // Store the token with 'valid' status
  await redisClient.set(key, "valid", "EX", REFRESH_TTL);
};

export const verifyRefreshTokenInStore = async (userId, token) => {
  const key = `refresh_token:${userId}:${token}`;
  const status = await redisClient.get(key);
  return status === "valid";
};

export const deleteRefreshToken = async (userId, token) => {
  const key = `refresh_token:${userId}:${token}`;
  await redisClient.del(key);
};

export const revokeAllUserRefreshTokens = async (userId) => {
  let cursor = "0";
  do {
    const [newCursor, keys] = await redisClient.scan(
      cursor,
      "MATCH",
      `refresh_token:${userId}:*`,
      "COUNT",
      100,
    );
    cursor = newCursor;
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } while (cursor !== "0");
};
