import axios from "axios";
import logger from "../config/logger.js";
import config from "../config/config.js";
import { notificationQueue } from "../queue/index.js";
import { shouldSendWhatsApp } from "./notificationControl.js";

const API_BASE_URL = config.FRONTEND_BASE_URL;

// Helper to send via Provider (Direct)
export const sendWhatsAppDirect = async (to, templateName, params = []) => {
  try {
    if (!shouldSendWhatsApp()) {
      logger.info(
        `[WhatsApp Skipped] WhatsApp sending is disabled for env: ${config.NODE_ENV}. To: ${to}, Template: ${templateName}`,
      );
      return { success: true, message: "WhatsApp skipped" };
    }

    // Construct dynamic component body
    const components = {};
    params.forEach((val, index) => {
      components[`body_${index + 1}`] = {
        type: "text",
        value: String(val),
      };
    });

    // FOR OTP
    if (templateName === config.AI_OTP_VERIFICATION && params[0]) {
      components["button_1"] = {
        subtype: "url",
        type: "text",
        value: String(params[0]),
      };
    }

    const finalPayload = {
      integrated_number: config.MSG91_INTEGRATED_NUMBER,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: templateName,
          language: {
            code: "en",
            policy: "deterministic",
          },
          namespace: config.MSG91_NAMESPACE,
          to_and_components: [
            {
              to: [String(to)],
              components: components,
            },
          ],
        },
      },
    };

    const response = await axios.post(
      config.MSG91_WHATSAPP_API_BASE_URL,
      finalPayload,
      {
        headers: {
          authkey: config.MSG91_AUTHKEY,
          "Content-Type": "application/json",
        },
      },
    );
    console.log("response", response.data);
    return { success: true, data: response.data };
  } catch (err) {
    logger.error("WhatsApp Request Error:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
};

// Queue Wrapper
const sendTemplateMessage = async (to, templateName, params = []) => {
  try {
    if (!shouldSendWhatsApp()) {
      logger.info(
        `[WhatsApp Skipped] WhatsApp sending is disabled for env: ${config.NODE_ENV}. To: ${to}`,
      );
      return { success: true, message: "WhatsApp skipped" };
    }
    await notificationQueue.add("whatsapp", { to, templateName, params });
    return { success: true, message: "WhatsApp message queued" };
  } catch (err) {
    logger.error("Failed to queue WhatsApp:", err);
    // Fallback
    return await sendWhatsAppDirect(to, templateName, params);
  }
};

export const sendWhatsAppOTPVerification = async (payload) => {
  const { destination, OTP } = payload;
  const displayDest = destination.startsWith("91")
    ? destination
    : `91${destination}`;
  return await sendTemplateMessage(displayDest, config.AI_OTP_VERIFICATION, [OTP]);
};



// If run directly via: node .\src\utils\sendWhatAppTemplete.js
// const runTest = async () => {
//   try {
//     console.log("Running direct WhatsApp test to 917385494029...");
//     const res = await sendWhatsAppOTPVerification({ destination: "7385494029", OTP: "411111" });
//     console.log("TEST RESULT:", res);
//   } catch (e) {
//     console.error("TEST ERROR:", e);
//   }
//   // process.exit(0);
// };
// runTest();