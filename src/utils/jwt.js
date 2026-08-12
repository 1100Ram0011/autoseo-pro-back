import jwt from "jsonwebtoken";
import config from "../config/config.js";
import User from "../models/businessDetailsModel.js";

const ACCESS_EXPIRES_IN = String(config.ACCESS_TOKEN_MAX_AGE);
const REFRESH_EXPIRES_IN = String(config.REFRESH_TOKEN_MAX_AGE);

export function signAccessToken(payload) {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
}

export function signReferenceToken(payload) {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_EXPIRY,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.JWT_REFRESH_SECRET);
}

import {
  storeRefreshToken,
  verifyRefreshTokenInStore,
  deleteRefreshToken,
} from "./tokenStore.js";

// refresh token
export async function refreshTokenService(token) {
  // 1. Verify Signature
  const payload = verifyRefreshToken(token);

  // 2. Verify existence in Redis (Token Rotation Check)
  const isValid = await verifyRefreshTokenInStore(payload.id, token);
  if (!isValid) {
    throw new Error("Invalid or Expired Refresh Token (Reuse Detected)");
  }

  const user = await User.findById(payload.id).select("-password");
  if (!user) throw new Error("User not found");

  // 3. Delete old token (Rotate)
  await deleteRefreshToken(user._id, token);

  // 4. Create new tokens
  // Ensure orgId is included if available (critical for POC/Org roles)
  const tokenPayload = {
    id: user._id,
    role: user.role,
    orgId: user.referenceId || user._id, // Best effort guess, or user needs to re-login if sensitive
  };

  const accessToken = signAccessToken(tokenPayload);
  const newRefresh = signRefreshToken({ id: user._id });

  // 5. Store new refresh token
  await storeRefreshToken(user._id, newRefresh);

  return { user, accessToken, refreshToken: newRefresh };
}
