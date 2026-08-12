/**
 * HeyGen Integration Configuration
 */

export const defaultConfig = {
  apiKey: process.env.HEYGEN_API_KEY || "",
  baseUrl: process.env.HEYGEN_BASE_URL || "https://api.heygen.com",
  v3BaseUrl: process.env.HEYGEN_V3_BASE_URL || "https://api.heygen.com/v3",
  v2BaseUrl: process.env.HEYGEN_V2_BASE_URL || "https://api.heygen.com/v2",
  v1BaseUrl: process.env.HEYGEN_V1_BASE_URL || "https://api.heygen.com/v1",
  streamingBaseUrl: process.env.HEYGEN_STREAMING_BASE_URL || "https://api.heygen.com/v1/streaming",
  uploadBaseUrl: process.env.HEYGEN_UPLOAD_BASE_URL || "https://upload.heygen.com",
  timeout: parseInt(process.env.HEYGEN_TIMEOUT || "60000", 10),
  webhookSecret: process.env.HEYGEN_WEBHOOK_SECRET || "",
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffFactor: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  },
  polling: {
    intervalMs: 5000,
    maxAttempts: 120, // 10 minutes default
    timeoutMs: 600000,
  },
};

export default defaultConfig;
