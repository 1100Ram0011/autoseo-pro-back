import jwt from "jsonwebtoken";
import crypto from "crypto";
import logger from "../config/logger.js";
import config from "../config/config.js";

const sign = (payload, opts = {}) => jwt.sign(payload, config.JWT_SECRET, opts);

/**
 * Creates fingerprint from user-agent + ip (sha256)
 */
export const createFingerprint = (req) => {
  try {
    const agent = req.headers["user-agent"] || "";
    const ip = req.ip || req.headers["x-forwarded-for"] || "";
    return crypto
      .createHash("sha256")
      .update(agent + ip)
      .digest("hex");
  } catch (err) {
    logger.error("createFingerprint failed: " + err.message);
    return null;
  }
};

/**
 * Generate JWT with role and fingerprint
 * expiresIn format acceptable by jsonwebtoken (e.g. "7d" / "15m")
 */
export const generateToken = (userId, role, req, expiresIn = "7d") => {
  if (!config.JWT_SECRET) {
    logger.error("JWT_SECRET missing from env");
    throw new Error("Server misconfiguration");
  }
  if (!userId || !role) {
    logger.error("generateToken requires userId and role");
    throw new Error("Invalid arguments");
  }

  const fingerprint = createFingerprint(req);
  const payload = { id: String(userId), role, fingerprint };

  const token = sign(payload, { expiresIn });
  logger.info(`Token generated for ${userId} role:${role}`);
  return token;
};
