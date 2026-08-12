import { getSignedUrl, getSignedCookies } from "@aws-sdk/cloudfront-signer";
import config from "../config/config.js";
import logger from "../config/logger.js";

const formatPrivateKey = (key) => {
  if (!key) return "";
  let formattedKey = key.trim();

  if (
    (formattedKey.startsWith('"') && formattedKey.endsWith('"')) ||
    (formattedKey.startsWith("'") && formattedKey.endsWith("'"))
  ) {
    formattedKey = formattedKey.slice(1, -1);
  }

  return formattedKey.replace(/\\n/g, "\n");
};

export const generateSignedUrl = (
  key,
  expiresInSeconds = 3600,
  extraParams = {},
) => {
  try {
    if (
      !config.CLOUDFRONT_PRIVATE_KEY ||
      !config.CLOUDFRONT_KEY_PAIR_ID ||
      !config.CLOUDFRONT_BASE_URL
    ) {
      throw new Error("Missing CloudFront configuration");
    }

    const baseUrl = config.CLOUDFRONT_BASE_URL.replace(/\/$/, "");
    const normalizeKey = (k) => k.replace(/^\/+/, "");
    const normalizedKey = normalizeKey(key);
    let url = `${baseUrl}/${normalizedKey}`;

    // Append extra parameters (e.g. response-content-disposition)
    if (Object.keys(extraParams).length > 0) {
      const queryString = Object.entries(extraParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      url += `?${queryString}`;
    }

    const privateKey = formatPrivateKey(config.CLOUDFRONT_PRIVATE_KEY);

    const signedUrl = getSignedUrl({
      url,
      keyPairId: config.CLOUDFRONT_KEY_PAIR_ID,
      privateKey,
      dateLessThan: new Date(Date.now() + expiresInSeconds * 1000),
    });

    return signedUrl;
  } catch (error) {
    logger.error("Error generating signed URL:", error);
    throw error;
  }
};

export const generateSignedCookies = (key, expiresInSeconds = 3600) => {
  try {
    if (
      !config.CLOUDFRONT_PRIVATE_KEY ||
      !config.CLOUDFRONT_KEY_PAIR_ID ||
      !config.CLOUDFRONT_BASE_URL
    ) {
      throw new Error("Missing CloudFront configuration");
    }

    const baseUrl = config.CLOUDFRONT_BASE_URL.replace(/\/$/, "");
    const normalizeKey = (k) => k.replace(/^\/+/, "");
    const normalizedKey = normalizeKey(key);
    const url = `${baseUrl}/${normalizedKey}`;
    const privateKey = formatPrivateKey(config.CLOUDFRONT_PRIVATE_KEY);

    const policy = {
      Statement: [
        {
          Resource: url,
          Condition: {
            DateLessThan: {
              "AWS:EpochTime": Math.floor(Date.now() / 1000) + expiresInSeconds,
            },
          },
        },
      ],
    };

    const cookies = getSignedCookies({
      keyPairId: config.CLOUDFRONT_KEY_PAIR_ID,
      privateKey,
      policy: JSON.stringify(policy),
    });

    return cookies;
  } catch (error) {
    logger.error("Error generating signed cookies:", error);
    throw error;
  }
};
