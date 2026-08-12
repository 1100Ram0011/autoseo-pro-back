/**
 * HeyGen Webhook Signature Verification Utility
 */

import crypto from "crypto";
import { defaultConfig } from "../config.js";
import { HeyGenWebhookError } from "../errors.js";

export const verifyWebhookSignature = (rawBody, signatureHeader, secret = defaultConfig.webhookSecret) => {
  if (!secret) {
    throw new HeyGenWebhookError("Webhook secret is missing.");
  }
  if (!signatureHeader) {
    throw new HeyGenWebhookError("Missing signature header.");
  }

  const payloadString = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(payloadString)
    .digest("hex");

  const normalizedSignature = signatureHeader.replace(/^sha256=/, "");

  try {
    const signatureBuffer = Buffer.from(normalizedSignature, "hex");
    const computedBuffer = Buffer.from(computedSignature, "hex");

    if (signatureBuffer.length !== computedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
  } catch (_) {
    return false;
  }
};

export default { verifyWebhookSignature };
