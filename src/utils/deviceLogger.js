import { UAParser } from "ua-parser-js";
import crypto from "crypto";
import UserDevice from "../models/UserDevice.js";
import logger from "../config/logger.js";

/**
 * Parses user agent and client IP, returning details for device storage.
 */
export const getDeviceDetails = (
  userAgentString = "",
  ip = "",
  browserBrands = "",
) => {
  const parser = new UAParser(userAgentString);
  const result = parser.getResult();
  console.log("UAParser result:", result);

  const userAgent = String(userAgentString || "");
  // Chromium browsers commonly present a Chrome-compatible User-Agent.
  // Sec-CH-UA carries the actual browser brand (for example, "Brave").
  const browserName =
    getBrowserName(userAgent, browserBrands) || result.browser.name || "";
  const osName = result.os.name || getOperatingSystem(userAgent);
  const deviceModel = result.device.model || "";
  const deviceVendor = result.device.vendor || "";
  // Chrome's reduced Android User-Agent commonly reports only "K", which is
  // a generic placeholder rather than the phone's actual model.
  const hasUsableDeviceModel =
    deviceModel && !/^(k|android|build)$/i.test(deviceModel.trim());

  let deviceName = "Unknown Device";
  if (deviceVendor || hasUsableDeviceModel) {
    const hardwareName = `${deviceVendor} ${
      hasUsableDeviceModel ? deviceModel : ""
    }`.trim();
    deviceName = browserName
      ? `${browserName} on ${hardwareName}`
      : hardwareName;
  } else if (browserName && osName) {
    deviceName = `${browserName} on ${osName}`;
  } else if (osName) {
    deviceName = osName;
  }

  // Map platform from type
  let platform = "web";
  const type = result.device.type; // mobile, tablet, smarttv, console, wearable, embedded
  if (type === "mobile") {
    platform = "mobile";
  } else if (type === "tablet") {
    platform = "tablet";
  } else if (
    osName.toLowerCase().includes("windows") ||
    osName.toLowerCase().includes("mac") ||
    osName.toLowerCase().includes("linux")
  ) {
    platform = "desktop";
  }

  return {
    deviceName,
    platform,
    ipAddress: ip,
  };
};

// Browsers increasingly reduce their User-Agent string. These small fallbacks
// still give users a useful session label when UAParser cannot classify it.
const getBrowserName = (userAgent, browserBrands = "") => {
  const brands = String(browserBrands || "");
  if (/\bbrave\b/i.test(userAgent) || /\bbrave\b/i.test(brands)) return "Brave";
  if (/edg\//i.test(userAgent)) return "Microsoft Edge";
  if (/opr\//i.test(userAgent)) return "Opera";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  if (/crios\//i.test(userAgent)) return "Chrome";
  if (/chrome\//i.test(userAgent))
    return /mobile/i.test(userAgent) ? "Mobile Chrome" : "Chrome";
  if (/safari\//i.test(userAgent))
    return /mobile|iphone|ipad/i.test(userAgent) ? "Mobile Safari" : "Safari";
  return "";
};

const getOperatingSystem = (userAgent) => {
  if (/windows nt/i.test(userAgent)) return "Windows";
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/mac os x/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "";
};

/** Refreshes the label for the device that made the authenticated request. */
export const refreshCurrentDeviceDetails = async (req, userId, deviceId) => {
  if (!userId || !deviceId) return;

  const userAgent = req.headers["user-agent"] || "";
  const rawIp =
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";
  const ip = rawIp.split(",")[0].trim();
  const { deviceName, platform, ipAddress } = getDeviceDetails(
    userAgent,
    ip,
    req.headers["x-browser-name"] || req.headers["sec-ch-ua"],
  );

  await UserDevice.updateOne(
    { userId, deviceId, isLoggedOut: false },
    {
      $set: {
        deviceName,
        platform,
        ipAddress,
        userAgent,
        lastActivity: new Date(),
      },
    },
  );
};

/**
 * Registers or updates a device record associated with a refresh token.
 */
export const logUserDevice = async (req, user, refreshToken) => {
  try {
    const userAgent = req.headers["user-agent"] || "";
    const browserIdentity =
      req.headers["x-browser-name"] || req.headers["sec-ch-ua"] || "";
    // get clean IP
    const rawIp =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    const ip = rawIp.split(",")[0].trim();

    const { deviceName, platform, ipAddress } = getDeviceDetails(
      userAgent,
      ip,
      req.headers["x-browser-name"] || req.headers["sec-ch-ua"],
    );

    // Chromium browsers can share the same User-Agent on one computer. Include
    // their reported brand so Chrome and Brave remain separate sessions.
    const deviceId = crypto
      .createHash("sha256")
      .update(`${user._id.toString()}|${userAgent}|${browserIdentity}|${ip}`)
      .digest("hex");

    // Remove any stale device entries with this identical token just in case
    await UserDevice.deleteMany({ userId: user._id, token: refreshToken });

    // Update or create device log
    await UserDevice.findOneAndUpdate(
      { userId: user._id, deviceId },
      {
        deviceName,
        platform,
        ipAddress,
        userAgent,
        token: "",
        lastActivity: new Date(),
        isLoggedOut: false,
      },
      { upsert: true, new: true },
    );
    logger.info(`Registered device [${deviceName}] for user [${user.email}]`);
    return deviceId;
  } catch (err) {
    logger.error("Failed to log user device:", err);
  }
};
