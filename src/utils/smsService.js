import axios from "axios";
import logger from "../config/logger.js";
const API_URL = process.env.SMS_API_URL;
const API_KEY = process.env.SMS_API_KEY;
const CLIENT_ID = process.env.SMS_CLIENT_ID;
const SENDER_ID = process.env.SMS_SENDER_ID;

export const sendSms = async ({ payload }) => {
  try {
    logger.info("Parsed fieldskkkkkkkkkk", payload);
    const response = await axios.post(
      API_URL,
      {
        senderId: SENDER_ID,
        message: payload?.message,
        mobileNumbers: payload?.mobile,
        apiKey: API_KEY,
        clientId: CLIENT_ID,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error sending SMS message:", error.message);
    throw error;
  }
};
