/**
 * HeyGen Core Utilities
 */

export const isNullOrUndefined = (val) => val === null || val === undefined;

export const cleanPayload = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (!isNullOrUndefined(value)) {
      const isStream = value && typeof value === "object" && typeof value.pipe === "function";
      acc[key] = typeof value === "object" && !Buffer.isBuffer(value) && !isStream
        ? cleanPayload(value)
        : value;
    }
    return acc;
  }, Array.isArray(obj) ? [] : {});
};

export const isValidUrl = (string) => {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const formatQueryParams = (params) => {
  if (!params) return "";
  const cleaned = cleanPayload(params);
  const searchParams = new URLSearchParams();
  Object.entries(cleaned).forEach(([key, val]) => {
    if (Array.isArray(val)) {
      val.forEach((item) => searchParams.append(key, item));
    } else {
      searchParams.append(key, val);
    }
  });
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
};

export const Utils = {
  isNullOrUndefined,
  cleanPayload,
  isValidUrl,
  sleep,
  formatQueryParams,
};

export default Utils;
