import UserLogs from "../models/userLogsModel.js";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";

export const logUserActivity = async (req, userId, email, action, status = "SUCCESS", errorMessage = null) => {
  try {
    // Extract IP Address
    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "UNKNOWN";

    // Parse User Agent
    const userAgent = req.headers["user-agent"] || "";
    const parser = new UAParser(userAgent);
    const parseResult = parser.getResult();

    // Get Geolocation from IP
    const geo = geoip.lookup(ipAddress) || {};

    // Create log entry
    const logEntry = await UserLogs.create({
      userId,
      email,
      action,
      status,
      ipAddress,
      userAgent,
      deviceInfo: {
        browser: parseResult.browser?.name || "Unknown",
        os: parseResult.os?.name || "Unknown",
        device: parseResult.device?.type || "desktop",
      },
      location: {
        country: geo.country || "Unknown",
        city: geo.city || "Unknown",
        coordinates: {
          latitude: geo.ll?.[0] || null,
          longitude: geo.ll?.[1] || null,
        },
      },
      authMethod: "OTP",
      errorMessage: errorMessage || null,
      sessionId: req.sessionID || null,
    });

    return logEntry;
  } catch (err) {
    console.error("Error logging user activity:", err);
    // Don't throw - logging should not break authentication
    return null;
  }
};