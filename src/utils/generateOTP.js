import Otp from "../models/bgv/otpSchema.js";

export const generateOtp = async (identifier, contact) => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await Otp.create({
    identifier, // gstNumber
    otp,
    expiresAt: new Date(Date.now() + 9 * 60 * 1000), // 9 mins
  });

  return otp;
};
