import axios from "axios";

const whatsapp_API_URL = process.env.whatsapp_API_URL;
const whatsapp_API_KEY = process.env.whatsapp_API_KEY;
const whatsapp_AUTH_USERNAME = process.env.Whatsapp_AUTH_USERNAME;
const whatsapp_AUTH_PASSWORD = process.env.Whatsapp_AUTH_PASSWORD;

export const sendWhatsappMessage = async (payload) => {
  try {
    // Create Basic Auth token from username and password
    const authToken = Buffer.from(`${whatsapp_AUTH_USERNAME}:${whatsapp_AUTH_PASSWORD}`).toString('base64');
    
    const response = await axios.post(whatsapp_API_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authToken}`,
      },
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error("WhatsApp API error:", error?.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

export const sendWhatsAppOtp = async (mobile, otp, country = "91") => {
  try {
    const mobileDigits = mobile.replace(/\D/g, "");
    const cleanCountryCode = country.replace("+", "").trim();
    let fullMobile1 = mobileDigits;
    if (fullMobile1.startsWith(cleanCountryCode)) {
      fullMobile1 = fullMobile1.slice(cleanCountryCode.length);
    }
    const fullMobileWithCountry = `${cleanCountryCode}${fullMobile1}`;

    const payload = {
      apiKey: whatsapp_API_KEY,
      campaignName: "Auth_otp",
      destination: fullMobileWithCountry,
      userName: "Mytek innovation pvt ltd ",
      templateParams: [otp],
      source: "new-landing-page form",
      media: {},
      buttons: [
        {
          type: "button",
          sub_type: "url",
          index: 0,
          parameters: [
            {
              type: "text",
              text: `${otp}`,
            },
          ],
        },
      ],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: {
        FirstName: "user",
      },
    };

    const whatsappResult = await sendWhatsappMessage(payload);
    return whatsappResult;
  } catch (error) {
    console.error("Error sending WhatsApp OTP:", error.message);
    throw error;
  }
};
