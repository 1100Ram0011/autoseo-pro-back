import crypto from "crypto";
import zlib from "zlib";
import util from "util";
import logger from "../config/logger.js";
import config from "../config/config.js";

const gzipAsync = util.promisify(zlib.gzip);

const SECRET_PASSPHRASE = config.RESPONSE_SECRET;
const HMAC_PASSPHRASE = config.RESPONSE_HMAC_SECRET;

// Derive 32-byte AES key from passphrase (sha256)
function deriveKey(passphrase) {
  return crypto.createHash("sha256").update(passphrase).digest();
}

// Encrypt + gzip payload
export async function encryptAndCompress(jsonObject) {
  try {
    // Convert JSON → string
    const jsonString = JSON.stringify(jsonObject);

    // GZIP the JSON string
    const gzipped = await gzipAsync(Buffer.from(jsonString, "utf8"));

    // Generate AES-256-CBC key & IV
    const key = deriveKey(SECRET_PASSPHRASE);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

    // Encrypt gzipped bytes
    let encrypted = cipher.update(gzipped);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const encryptedB64 = encrypted.toString("base64");
    const ivB64 = iv.toString("base64");

    // Compute HMAC
    const hmac = crypto
      .createHmac("sha256", HMAC_PASSPHRASE)
      .update(ivB64 + "." + encryptedB64)
      .digest("base64");

    // Envelope to send
    const envelope = {
      iv: ivB64,
      encrypted: encryptedB64,
      hmac,
    };

    return envelope;
  } catch (err) {
    logger.error("Encryption error:", err);
    throw err;
  }
}

// Express response helper
export async function sendEncrypted(res, payload) {
  try {
    const envelope = await encryptAndCompress(payload);

    // Send as JSON
    res.setHeader("Content-Type", "application/json");
    return res.send(JSON.stringify(envelope));
  } catch (err) {
    res.status(500).json({ message: "Failed to encrypt response" });
  }
}
