import config from "../config/config.js";
import logger from "../config/logger.js";

const NOTIFICATION_PERMISSIONS = {
  development: {
    sms: false,
    email: false,
    whatsapp: true,
  },
  production: {
    sms: true,
    email: true,
    whatsapp: true,
  },
};

const getCurrentEnv = () => config.NODE_ENV;

// Log permissions once on startup
const currentEnv = getCurrentEnv();
logger.info(
  `[NotificationControl] Loaded permissions for '${currentEnv}':`,
  NOTIFICATION_PERMISSIONS[currentEnv] || "Unknown Env",
);

export const shouldSendSMS = () => {
  const env = getCurrentEnv();
  return NOTIFICATION_PERMISSIONS[env]?.sms ?? false;
};

export const shouldSendEmail = () => {
  const env = getCurrentEnv();
  return NOTIFICATION_PERMISSIONS[env]?.email ?? false;
};

export const shouldSendWhatsApp = () => {
  const env = getCurrentEnv();
  return NOTIFICATION_PERMISSIONS[env]?.whatsapp ?? false;
};

export const getCurrentEmailService = () => {
  return config.EMAIL_SERVICE;
};
