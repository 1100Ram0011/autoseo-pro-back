import axios from "axios";
import bcrypt from "bcryptjs";
import {
  sendBusinessVerificationOTP,
  sendDeleteOrganizationOTPEmail,
  sendLoginEmailOTP,
  sendRegisterEmailOTP,
} from "./emailServices.js";
import logger from "../config/logger.js";
import config from "../config/config.js";
import redisClient from "../config/redis.js";
import { notificationQueue } from "../queue/index.js";
import { shouldSendSMS, shouldSendEmail } from "./notificationControl.js";
import userModel from "../models/userModel.js";
import { checkIfDemoUser } from "./demoUserHelper.js";

// Helper to generate and store OTP
const generateAndStoreOTP = async (mobileNumber, email, identifier) => {
  if (!mobileNumber && !email) {
    logger.error("No mobile or email provided for OTP");
    throw new Error("Mobile or Email is required");
  }

  const limitKey = `OTP_LIMIT:${identifier}`;
  const otpKey = `OTP:${identifier}`;

  // Check rate limit (1 min)
  const isLimited = await redisClient.get(limitKey);
  if (isLimited && config?.NODE_ENV !== "development") {
    return {
      success: false,
      message: "Please wait 1 minute before resending OTP",
    };
  }

  // Generate 6-digit OTP
  let otp;
  if (config?.REVIEW_ACCOUNT_EMAIL === identifier) {
    otp = config?.REVIEW_ACCOUNT_OTP;
  } else {
    otp = Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Encrypt OTP
  const hashedOtp = await bcrypt.hash(otp, 10);

  // Expiry: 10 mins (600 seconds)
  await redisClient.set(otpKey, hashedOtp, "EX", 600);

  // Set Rate Limit: 1 min (60 seconds)
  await redisClient.set(limitKey, "1", "EX", 60);

  return { success: true, otp };
};

// Helper to generate and store Business Email OTP
// const generateAndStoreBusinessOTP = async (userId, email) => {
//   if (!email) {
//     logger.error("No email provided for business OTP");
//     throw new Error("Business email is required");
//   }

//   console.log("userId", userId);
//   console.log("email", email);

//   const limitKey = `BUSINESS_OTP_LIMIT:${userId}`;
//   const otpKey = `BUSINESS_OTP:${userId}`;
//   const emailKey = `BUSINESS_OTP_EMAIL:${userId}`;

//   // Check rate limit (1 min)
//   const isLimited = await redisClient.get(limitKey);
//   if (isLimited) {
//     return {
//       success: false,
//       message: "Please wait 1 minute before resending OTP",
//     };
//   }

//   // Generate 6-digit OTP
//   const otp = Math.floor(100000 + Math.random() * 900000).toString();

//   // Encrypt OTP
//   const hashedOtp = await bcrypt.hash(otp, 10);

//   // Store hashed OTP → 5 min (300 seconds)
//   await redisClient.set(otpKey, hashedOtp, "EX", 300);
//   // Store email tied to this OTP so verify can cross-check → same TTL
//   await redisClient.set(emailKey, email, "EX", 300);

//   // Set rate limit → 1 min (60 seconds)
//   await redisClient.set(limitKey, "1", "EX", 60);

//   return { success: true, otp };
// };

const generateAndStoreBusinessOTP = async (userId, primaryEmail = "") => {
  const limitKey = `BUSINESS_OTP_LIMIT:${userId}`;
  const otpKey = `BUSINESS_OTP:${userId}`;
  const emailKey = `BUSINESS_OTP_EMAIL:${userId}`;

  /* ── Rate-limit check (1 min) ── */
  const isLimited = await redisClient.get(limitKey);
  if (isLimited) {
    return {
      success: false,
      message: "Please wait 1 minute before resending OTP",
    };
  }

  /* ── Generate & hash OTP ── */
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);

  /* ── Persist OTP (5 min TTL) ── */
  await redisClient.set(otpKey, hashedOtp, "EX", 300);

  /* ── Store primary email for verify cross-check (only when provided) ── */
  if (primaryEmail) {
    await redisClient.set(
      emailKey,
      primaryEmail.trim().toLowerCase(),
      "EX",
      300,
    );
  }

  /* ── Rate-limit lock (1 min) ── */
  await redisClient.set(limitKey, "1", "EX", 60);

  return { success: true, otp };
};

// Common SMS Sender (Direct)
export const sendSMSDirect = async (mobileNumber, otp) => {
  try {
    if (!shouldSendSMS()) {
      logger.info(
        `[SMS Skipped] SMS sending is disabled for env: ${config.NODE_ENV}. OTP was: ${otp}`,
      );
      return;
    }

    const payload = {
      senderId: config.SMS_SENDER_ID,
      message: `Dear user, Your one time password for account verification is - ${otp}. Team MYTEK.`,
      MobileNumbers: `91${mobileNumber}`,
      apiKey: config.SMS_API_KEY,
      clientId: config.SMS_CLIENT_ID,
    };
    const smsResponse = await axios.post(
      "https://api.smslane.com/api/v2/SendSMS",
      payload,
      { headers: { "Content-Type": "application/json" } },
    );
    if (smsResponse.statusText === "OK" && smsResponse?.status === 200) {
      logger.info("SMS OTP sent successfully");
    } else {
      logger.error(
        ` SMS OTP failed: ${smsResponse.data?.Details || "Unknown error"}`,
      );
    }
  } catch (smsErr) {
    logger.error(`SMS sending error: ${smsErr.message}`);
    throw smsErr; // Throw for retry
  }
};

// Queue Wrapper
const sendSMS = async (mobileNumber, otp) => {
  try {
    if (!shouldSendSMS()) {
      logger.info(
        `[SMS Skipped] SMS sending is disabled for env: ${config.NODE_ENV}. OTP was: ${otp}`,
      );
      return;
    }
    await notificationQueue.add("sms", { mobileNumber, otp });
    logger.info("SMS OTP queued successfully");
  } catch (err) {
    logger.error("Failed to queue SMS:", err);
    // Fallback
    await sendSMSDirect(mobileNumber, otp);
  }
};

export const sendLoginOTP = async (mobileNumber, email) => {
  try {
    const identifier = mobileNumber || email;
    const result = await generateAndStoreOTP(mobileNumber, email, identifier);

    if (!result.success) return result; // Rate limit hit

    const { otp } = result;

    if (mobileNumber) {
      await sendSMS(mobileNumber, otp);
    }
    const isDemoUser = email ? await checkIfDemoUser(email) : false;
    const otps = (config.NODE_ENV === "development" || isDemoUser) ? ` ${otp}` : "";

    if (email) {
      if (shouldSendEmail()) {
        try {
          logger.info("shouldSendEmail", otp);
          logger.info(`Sending Login OTP Email to: ${email}  otp ${otp}`);
          const emailResponse = await sendLoginEmailOTP(email, otp);
          if (emailResponse.success) {
            logger.info("Login Email OTP sent successfully");
            return {
              success: emailResponse,
              message: `OTP sent successfully ${otps}`,
            };
          } else {
            logger.error(`Login Email OTP failed: ${emailResponse.error}`);
            return emailResponse;
          }
        } catch (emailErr) {
          logger.error(`Email sending error: ${emailErr.message}`);
          return {
            success: false,
            message: emailErr.message || "Failed to send email OTP",
          };
        }
      } else {
        logger.info(
          `[Email Skipped] Email sending is disabled for env: ${config.NODE_ENV}. Login OTP: ${otp}`,
        );
        return {
          success: true,
          message: `OTP sent successfully : ${otp} `,
        };
      }
    }

    return {
      success: true,
      message: `OTP sent successfully ${otps}`,
    };
  } catch (error) {
    logger.error(`Fatal Login OTP Service Error: ${error.message}`);
    return {
      success: false,
      message: error.message || "Failed to generate or send OTP",
    };
  }
};

// export const sendWebsiteVerifyOTP = async (emails = [], userId, mobileNumbers = [], loggedInUserEmail) => {
//   try {
//     const emailArray = Array.isArray(emails) ? emails : [emails];
//     const mobileArray = Array.isArray(mobileNumbers) ? mobileNumbers : [mobileNumbers];

//     const validEmails = emailArray.filter((e) => typeof e === "string" && e.trim() !== "");
//     const validMobiles = mobileArray.filter((m) => typeof m === "string" && m.trim() !== "");

//     console.log("sendWebsiteVerifyOTP →", { userId, emails: validEmails, mobileNumbers: validMobiles });

//     if (validEmails.length === 0 && validMobiles.length === 0) {
//       return { success: false, message: "Provide at least one email or mobile number" };
//     }

//     /* ── Generate ONE OTP for this request ── */
//     const primaryEmail = validEmails[0] ?? "";
//     const result = await generateAndStoreBusinessOTP(userId, primaryEmail);
//     if (!result.success) return result; // rate-limit hit

//     const { otp } = result;
//     console.log("OTP generated (single):", otp);

//     if (emails) {
//       const emailToSend =
//         loggedInUserEmail === config.DEMO_EMAIL
//           ? [config.DEMO_EMAIL]
//           : validEmails;

//       logger.info(`Final OTP destination: ${emailToSend}`);
//       if (shouldSendEmail()) {
//         try {
//           logger.info("shouldSendEmail", otp);
//           logger.info(`Sending Login OTP Email to: ${emails}  otp ${otp}`);
//           const emailResponse = await sendBusinessVerificationOTP(emailToSend, otp);
//           if (emailResponse.success) {
//             logger.info("Login Email OTP sent successfully");
//           } else {
//             logger.error(`Login Email OTP failed: ${emailResponse.error}`);
//           }

//           await sendSMSDirect(mobileNumbers, otp);

//         } catch (emailErr) {
//           logger.error(`Email sending error: ${emailErr.message}`);
//         }
//       } else {
//         logger.info(
//           `[Email Skipped] SMS sending is disabled for env: ${config.NODE_ENV}. Login OTP: ${otp}`,
//         );
//       }
//     } else {
//       logger.info(
//         `[SMS Skipped] SMS sending is disabled for env: ${config.NODE_ENV}. Login OTP: ${otp}`,
//       );
//     }

//     const otps = config.NODE_ENV === "development" ? ` ${otp}` : "";

//     return {
//       success: true,
//       message: `OTP sent successfully ${otp}`,
//     };
//   } catch (error) {
//     logger.error(`Fatal Business OTP Service Error: ${error.message}`);
//     return {
//       success: false,
//       message: error.message || "Failed to generate or send OTP",
//     };
//   }
// };

export const sendWebsiteVerifyOTP = async (
  emails = [],
  userId,
  mobileNumbers = [],
  loggedInUserEmail,
) => {
  try {
    const mainValidEmails = emails.filter(
      (e) => typeof e === "string" && e.trim() !== "",
    );

    const user = await userModel.findById(userId);
    const isDemoUser = user?.email ? await checkIfDemoUser(user.email) : false;

    // Determine which emails to actually send the OTP to:
    // If it's a demo user, we only send the OTP to their registered email.
    // Otherwise, we send it to the business email they provided.
    const emailsToSendTo =
      isDemoUser && user?.email
        ? [user.email]
        : mainValidEmails;

    const validMobiles = mobileNumbers.filter(
      (m) => typeof m === "string" && m.trim() !== "" && m.trim() !== undefined,
    );

    console.log("sendWebsiteVerifyOTP →", {
      userId,
      emails: emailsToSendTo,
      mobileNumbers: validMobiles,
    });

    if (mainValidEmails.length === 0 && validMobiles.length === 0) {
      return {
        success: false,
        message: "Provide at least one email or mobile number",
      };
    }

    /* ── Generate ONE OTP for this request ── */
    // We store the business email they entered in Redis to verify it later
    const primaryEmail = mainValidEmails[0] ?? "";
    const result = await generateAndStoreBusinessOTP(userId, primaryEmail);
    if (!result.success) return result; // rate-limit hit

    const { otp } = result;
    console.log("OTP generated (single):", otp);

    /* ── Loop: deliver to every email ── */
    for (const email of emailsToSendTo) {
      if (shouldSendEmail()) {
        try {
          logger.info(`Sending Business OTP email → ${email}`);
          const emailResponse = await sendBusinessVerificationOTP(email, otp);
          if (emailResponse.success) {
            logger.info(`Email OTP sent → ${email}`);
          } else {
            logger.error(`Email OTP failed → ${email}: ${emailResponse.error}`);
          }
        } catch (emailErr) {
          logger.error(`Email sending error (${email}): ${emailErr.message}`);
        }
      } else {
        logger.info(
          `[Email Skipped] env: ${config.NODE_ENV} — OTP: ${otp} → ${email}`,
        );
      }
    }

    /* ── Loop: deliver to every phone ── */
    for (const mobile of validMobiles) {
      try {
        logger.info(`Sending Business OTP SMS → ${mobile}`);
        await sendSMSDirect(mobile.trim(), otp);
        logger.info(`SMS OTP sent → ${mobile}`);
      } catch (smsErr) {
        logger.error(`SMS sending error (${mobile}): ${smsErr.message}`);
      }
    }

    const otpSuffix = (config.NODE_ENV === "development" || isDemoUser) ? ` ${otp}` : "";
    return {
      success: true,
      message: `OTP sent successfully${otpSuffix}`,
    };
  } catch (error) {
    logger.error(`Fatal Business OTP Service Error: ${error.message}`);
    return {
      success: false,
      message: error.message || "Failed to generate or send OTP",
    };
  }
};

export const sendRegisterOTP = async (
  mobileNumber,
  email,
  userName = "User",
) => {
  try {
    const identifier = mobileNumber || email;
    const result = await generateAndStoreOTP(mobileNumber, email, identifier);

    if (!result.success) return result; // Rate limit hit

    const { otp } = result;

    if (mobileNumber) {
      await sendSMS(mobileNumber, otp);
    }

    if (email) {
      if (shouldSendEmail()) {
        try {
          logger.info(`Sending Register OTP Email to: ${email}`);
          const emailResponse = await sendRegisterEmailOTP(
            email,
            userName,
            otp,
          );
          if (emailResponse.success) {
            logger.info("Register Email OTP sent successfully");
          } else {
            logger.error(`Register Email OTP failed: ${emailResponse.error}`);
          }
        } catch (emailErr) {
          logger.error(`Email sending error: ${emailErr.message}`);
        }
      } else {
        logger.info(
          `[Email Skipped] Email sending is disabled for env: ${config.NODE_ENV}. Register OTP: ${otp}`,
        );
      }
    }

    const isDemoUser = email ? await checkIfDemoUser(email) : false;
    const otps = (config.NODE_ENV === "development" || isDemoUser) ? ` ${otp}` : "";

    return {
      success: true,
      message: `OTP sent successfully${otps}`,
    };
  } catch (error) {
    logger.error(`Fatal Register OTP Service Error: ${error.message}`);
    return {
      success: false,
      message: error.message || "Failed to generate or send OTP",
    };
  }
};

// SEND OTP for delete org data
export const sendDeleteOrganizationOTP = async (
  mobileNumber,
  email,
  organizationName = "Organization",
  organizationId,
) => {
  try {
    if (!organizationId) {
      return {
        success: false,
        message: "organizationId is required",
      };
    }

    const result = await generateAndStoreDeleteOrganizationOTP(
      organizationId,
      mobileNumber,
      email,
    );

    if (!result.success) return result;

    const { otp } = result;

    /* ================= SEND SMS ================= */
    if (mobileNumber) {
      await sendSMS(mobileNumber, otp);
    }

    /* ================= SEND EMAIL ================= */
    if (email) {
      if (shouldSendEmail()) {
        try {
          logger.info(`Sending Delete Organization OTP Email to: ${email}`);

          const emailResponse = await sendDeleteOrganizationOTPEmail(
            email,
            organizationName,
            otp,
          );

          if (emailResponse.success) {
            logger.info("Delete Organization OTP email sent");
          } else {
            logger.error(
              `Delete Organization OTP email failed: ${emailResponse.error}`,
            );
          }
        } catch (emailErr) {
          logger.error(`Delete Org OTP Email error: ${emailErr.message}`);
        }
      } else {
        logger.info(
          `[Email Skipped] Env=${config.NODE_ENV} Delete Org OTP: ${otp}`,
        );
      }
    }

    const isDemoUser = email ? await checkIfDemoUser(email) : false;
    const otps = (config.NODE_ENV === "development" || isDemoUser) ? ` ${otp}` : "";

    return {
      success: true,
      message: `Delete organization OTP sent successfully${otps}`,
    };
  } catch (error) {
    logger.error(
      `Fatal Delete Organization OTP Service Error: ${error.message}`,
    );
    return {
      success: false,
      message: error.message || "Failed to generate or send OTP",
    };
  }
};

//  GENERATE OTP for delete org data
export const generateAndStoreDeleteOrganizationOTP = async (
  organizationId,
  mobileNumber,
  email,
) => {
  try {
    if (!organizationId) {
      logger.error("organizationId missing for delete org OTP");
      return {
        success: false,
        message: "organizationId is required",
      };
    }

    if (!mobileNumber && !email) {
      logger.error("No mobile or email provided for delete org OTP");
      return {
        success: false,
        message: "Mobile or Email is required",
      };
    }

    const identifier = `ERASE_ORG:${organizationId}`;

    const limitKey = `OTP_LIMIT:${identifier}`;
    const otpKey = `OTP:${identifier}`;

    /* ================= RATE LIMIT ================= */
    const isLimited = await redisClient.get(limitKey);
    if (isLimited) {
      return {
        success: false,
        message: "Please wait 1 minute before resending OTP",
      };
    }

    /* ================= OTP GENERATION ================= */
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    /* ================= STORE OTP ================= */
    await redisClient.set(otpKey, hashedOtp, "EX", 600);
    await redisClient.set(limitKey, "1", "EX", 60);

    logger.info(`Delete Organization OTP generated | orgId=${organizationId}`);

    return {
      success: true,
      otp,
    };
  } catch (error) {
    logger.error(`Delete Org OTP Generation Fatal Error: ${error.message}`);
    return {
      success: false,
      message: "Unable to generate delete OTP",
    };
  }
};
