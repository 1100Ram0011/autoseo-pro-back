import crypto from "crypto";

/**
 * Verifies the signature sent by Razorpay to ensure authenticity.
 * @param {string} orderId - The Razorpay Order ID.
 * @param {string} paymentId - The Razorpay Payment ID.
 * @param {string} signature - The Razorpay Signature.
 * @param {string} secret - The Razorpay Key Secret.
 * @returns {boolean} - True if signature is valid, false otherwise.
 */
export const verifyRazorpaySignature = (orderId, paymentId, signature, secret) => {
  if (!orderId || !paymentId || !signature || !secret) {
    return false;
  }
  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return generatedSignature === signature;
};
