import axios from "axios";
import logger from "../config/logger.js";
import config from "../config/config.js";
import { shouldSendWhatsApp } from "./notificationControl.js";

// Helper for WhatsApp API call
const sendProviderRequest = async (
  to,
  templateName,
  params = [],
  locale = "en",
) => {
  try {
    if (!shouldSendWhatsApp()) {
      logger.info(
        `[WhatsApp Skipped] WhatsApp sending is disabled for env: ${config.NODE_ENV}. To: ${to}`,
      );
      return { success: true, message: "WhatsApp skipped" };
    }

    const components = {};
    params.forEach((val, index) => {
      components[`body_${index + 1}`] = {
        type: "text",
        value: String(val),
      };
    });

    const finalPayload = {
      integrated_number: config.MSG91_INTEGRATED_NUMBER,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: templateName,
          language: {
            code: locale,
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

    return { success: true, data: response.data };
  } catch (error) {
    logger.error("WhatsApp API Error:", error?.response?.data || error.message);
    return { success: false, error: error?.response?.data || error.message };
  }
};

export const sendWhatsappMessage = async (payload) => {
  const { to, templateName, params } = payload;
  const displayDest = to.startsWith("91") ? to : `91${to}`;
  return await sendProviderRequest(displayDest, templateName, params);
};

export const sendWhatsappOTP = async (payload) => {
  const { to, otp } = payload;
  const displayDest = to.startsWith("91") ? to : `91${to}`;
  return await sendProviderRequest(displayDest, config.Otp, [otp]);
};
