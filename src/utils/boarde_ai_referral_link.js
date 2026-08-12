import axios from "axios";
import { shouldSendWhatsApp } from "./notificationControl.js";
import logger from "../config/logger.js";

const normalizeDestination = (mobile, countryCode = "") => {
  const mobileDigits = String(mobile || "").replace(/\D/g, "");
  const countryDigits = String(countryCode || "").replace(/\D/g, "");

  if (!mobileDigits) {
    return "";
  }

  if (!countryDigits) {
    return mobileDigits;
  }

  if (mobileDigits.startsWith(countryDigits)) {
    return mobileDigits;
  }

  return `${countryDigits}${mobileDigits}`;
};

const extractReferralPath = (referralLink) => {
  if (!referralLink) {
    return "";
  }

  try {
    const url = new URL(referralLink);
    return `${url.pathname}${url.search}`.replace(/^\/+/, "");
  } catch (error) {
    console.error("Invalid referral URL:", referralLink);
    return "";
  }
};

const resolveReferralCampaignName = () => {
  const env = (process.env.NODE_ENV || "").toLowerCase();
  return env === "production"
    ? "boradeai_referral_link_prod"
    : "boradeai_referral_link_test";
};

export const sendBoradeAiReferralLinkWhatsapp = async ({
  mobile,
  countryCode,
  recipientName,
  referralLink,
  inviterName,
  attributes = {},
}) => {
  if (!shouldSendWhatsApp()) {
    return { success: true, skipped: true, message: "WhatsApp skipped" };
  }

  const destination = normalizeDestination(mobile, countryCode);
  if (!destination) {
    return { success: false, message: "Mobile number missing" };
  }

  const linkPath = extractReferralPath(referralLink);
  if (!linkPath) {
    return { success: false, message: "Referral link missing or invalid" };
  }

  const payload = {
    apiKey: process.env.whatsapp_API_KEY,
    campaignName: resolveReferralCampaignName(),
    destination,
    userName: "Mytek innovation pvt ltd ",
    templateParams: [recipientName || "User", inviterName, linkPath],
    source: "new-landing-page form",
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
    attributes,
    paramsFallbackValue: {
      FirstName: "user",
    },
  };

  try {
    const response = await axios.post(process.env.whatsapp_API_URL, payload);
    logger.info("Referral WhatsApp send success", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(
      "Referral WhatsApp send failed:",
      error?.response?.data || error.message,
    );
    return {
      success: false,
      message: error?.response?.data?.message || error.message,
    };
  }
};
