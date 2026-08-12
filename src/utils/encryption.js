import CryptoJS from "crypto-js";
import config from "../config/config.js";

const ENCRYPTION_KEY = config.CREDENTIAL_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error("CREDENTIAL_ENCRYPTION_KEY is missing in environment");
}

export const encryptData = (value) => {
  const encrypted = CryptoJS.AES.encrypt(
    String(value),
    ENCRYPTION_KEY,
  ).toString();

  return Buffer.from(encrypted, "utf8").toString("base64");
};

export const decryptData = (value) => {
  if (!value) {
    return "";
  }

  const input = String(value).trim();
  const candidates = [input];

  try {
    const decoded = Buffer.from(input, "base64").toString("utf8");
    if (decoded && decoded !== input) {
      candidates.unshift(decoded);
    }
  } catch {
    // Ignore decode failures and fall back to the raw input.
  }

  for (const candidate of candidates) {
    try {
      const decrypted = CryptoJS.AES.decrypt(
        candidate,
        ENCRYPTION_KEY,
      ).toString(CryptoJS.enc.Utf8);

      if (decrypted) {
        return decrypted;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return "";
};
