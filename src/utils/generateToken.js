import logger from "../config/logger.js";
import { signReferenceToken } from "./jwt.js";

export const generateToken = (user) => {
  try {
    if (!user) {
      logger.error("Token generation attempted without userId");
      throw new Error("User ID is required to generate token");
    }

    const token = signReferenceToken({
      id: user?._id || user?.id,
      role: user?.role,
    });

    logger.info(`Token generated for user: ${user._id}`);
    return token;
  } catch (error) {
    logger.error("JWT Generation Error: " + error.message);
    throw new Error("Failed to generate authentication token");
  }
};

export const generateRefreshToken = (user) => {
  return signReferenceToken({
    id: user._id || user?.id,
    role: user.role,
  });
};
