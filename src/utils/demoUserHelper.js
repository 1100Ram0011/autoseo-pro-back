import DemoEmail from "../models/DemoEmail.js";
import config from "../config/config.js";

/**
 * Checks if a given email is designated as a demo user.
 *
 * @param {string} email - The email address to check.
 * @returns {Promise<boolean>} True if it matches config.DEMO_EMAIL, config.DEMO_EMAIL1, or exists in DemoEmail collection.
 */
export const checkIfDemoUser = async (email) => {
  if (!email) return false;
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Check env variable fallback
  const configEmails = [
    config.DEMO_EMAIL?.toLowerCase().trim(),
    config.DEMO_EMAIL1?.toLowerCase().trim(),
    config.DEMO_EMAIL2?.toLowerCase().trim(),
    config.DEMO_EMAIL3?.toLowerCase().trim(),
    config.DEMO_EMAIL4?.toLowerCase().trim(),
    config.DEMO_EMAIL5?.toLowerCase().trim(),
    config.DEMO_EMAIL6?.toLowerCase().trim(),
  ].filter(Boolean);

  if (configEmails.includes(normalizedEmail)) {
    return true;
  }

  // 2. Check DB dynamic collection
  try {
    const exists = await DemoEmail.exists({ email: normalizedEmail });
    return !!exists;
  } catch (error) {
    console.error("Error checking demo user email in DB:", error);
    return false;
  }
};
