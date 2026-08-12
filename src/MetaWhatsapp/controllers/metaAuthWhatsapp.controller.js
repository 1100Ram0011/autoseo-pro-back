import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import User from "../../models/userModel.js";
import {
  buildOAuthURL,
  exchangeCodeForToken,
  getUserInfo,
  fetchAllPhoneNumbers,
  fetchNumbersForWabaId,
} from "../services/metaOAuth.services.js";
import { verifyRefreshToken } from "../../utils/jwt.js";
import config from "../../config/config.js";
import MetaGraphClient from "../services/metaFbWhatsapp.client.js";

// ── Helper ─────────────────────────────────────
export const saveWhatsAppNumber = async (userId, n) => {
  return WhatsAppToken.findOneAndUpdate(
    { phoneNumberId: n.phoneNumberId },
    {
      $set: {
        userId: new mongoose.Types.ObjectId(userId),
        phoneNumberId: n.phoneNumberId,
        wabaId: n.wabaId,
        displayName: n.displayName || n.phoneNumber,
        phoneNumber: n.phoneNumber,
        accessToken: n.accessToken,
        status: n.status || "active",
        qualityRating: n.qualityRating || "UNKNOWN",
        messagingLimit: n.messagingLimit || "TIER_1K",
        connectedAt: new Date(),
      },
      $setOnInsert: {
        label: "",
        isPrimary: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

export const connectMeta = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const url = buildOAuthURL(userId);

    console.log("[OAuth] Connect initiated for user:", userId);

    return res.status(200).json({
      success: true,
      data: { url },
    });
  } catch (error) {
    console.error("[connectMeta error]:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to initiate Meta connection",
    });
  }
};

export const metaCallback = async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log("[Meta Callback Query]:", req.query);

  const FRONTEND = config.FRONTEND_BASE_URL;

  if (error) {
    return res.redirect(
      `${FRONTEND}/integrations/whatsapp/meta?status=error&message=${encodeURIComponent(error_description || error)}`,
    );
  }

  if (!code) {
    return res.redirect(
      `${FRONTEND}/integrations/whatsapp/meta?status=error&message=Authorization code missing`,
    );
  }

  let userId;

  try {
    const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
    userId = decoded.userId;
  } catch {
    return res.redirect(
      `${FRONTEND}/integrations/whatsapp/meta?status=error&message=Invalid state`,
    );
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.redirect(
        `${FRONTEND}/integrations/whatsapp/meta?status=error&message=User not found`,
      );
    }

    const token = await exchangeCodeForToken(code);
    const numbers = await fetchAllPhoneNumbers(token);

    if (!numbers || numbers.length === 0) {
      return res.redirect(
        `${FRONTEND}/integrations/whatsapp/meta?status=error&message=No WhatsApp numbers found`,
      );
    }

    for (const n of numbers) {
      await saveWhatsAppNumber(userId, n);
    }

    return res.redirect(
      `${FRONTEND}/integrations/whatsapp/meta?status=success&numbers=${numbers.length}`,
    );
  } catch (err) {
    console.error(err);

    return res.redirect(
      `${FRONTEND}/integrations/whatsapp/meta?status=error&message=Meta connection failed`,
    );
  }
};

export const fetchConnectedNumber = async (req, res, next) => {
  try {
    const ConnectedUsersPhone = await WhatsAppToken.find({
      userId: req.user.id,
    });

    if (!ConnectedUsersPhone) {
      return res.status(404).json({
        success: false,
        message: "No connected numbers found",
      });
    }

    return res.json({
      success: true,
      data: ConnectedUsersPhone,
    });
  } catch (err) {
    next(err);
  }
};

export const disconnectConnectedNumber = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const deletedNumber = await WhatsAppToken.findOneAndDelete({
      _id: id,
      userId,
    });

    if (!deletedNumber) {
      return res.status(404).json({
        success: false,
        message: "WhatsApp number not found or already disconnected",
      });
    }

    return res.status(200).json({
      success: true,
      message: "WhatsApp number disconnected successfully",
      data: deletedNumber,
    });
  } catch (err) {
    next(err);
  }
};

export const syncNumberMessagingLimit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const tokenDoc = await WhatsAppToken.findOne({ _id: id, userId }).select("+accessToken");

    if (!tokenDoc) {
      return res.status(404).json({
        success: false,
        message: "WhatsApp number token not found",
      });
    }

    const accessToken = tokenDoc.accessToken;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "No access token found to sync with Meta",
      });
    }

    let matchedPhone = null;

    if (tokenDoc.wabaId) {
      const resp = await MetaGraphClient.fetchWabaPhoneNumbers(tokenDoc.wabaId, accessToken);
      matchedPhone = resp?.find((p) => p.id === tokenDoc.phoneNumberId) || resp?.[0];
    }

    if (matchedPhone) {
      tokenDoc.messagingLimit = matchedPhone.messaging_limit_tier || tokenDoc.messagingLimit || "TIER_1K";
      tokenDoc.qualityRating = (matchedPhone.quality_rating || tokenDoc.qualityRating || "UNKNOWN").toUpperCase();
      tokenDoc.status = matchedPhone.status === "CONNECTED" ? "active" : tokenDoc.status;
      await tokenDoc.save();

      return res.status(200).json({
        success: true,
        message: "Messaging limit and quality status synced successfully from Meta",
        data: tokenDoc,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Sync completed",
      data: tokenDoc,
    });
  } catch (err) {
    console.error("[syncNumberMessagingLimit error]:", err);
    next(err);
  }
};

export const fetchWabaNumbers = async (req, res, next) => {
  try {
    const { tempToken, wabaId } = req.body;

    const payload = jwt.verify(tempToken, config.JWT_SECRET);

    if (payload.userId !== req.user._id.toString())
      return res.status(403).json({
        success: false,
        message: "Token mismatch",
      });

    const numbers = await fetchNumbersForWabaId(
      wabaId.trim(),
      payload.accessToken,
    );

    return res.json({
      success: true,
      data: numbers,
    });
  } catch (err) {
    next(err);
  }
};

// ── Embedded Signup: code → access token → phone numbers → save ──────────────
// export const connectEmbeddedWhatsapp = async (req, res) => {

//     console.log('connectEmbeddedWhatsapp called')
//     console.log(' Body:', JSON.stringify(req.body))
//     const { code, wabaId, phoneNumberId } = req.body

//     // resolve userId from auth middleware OR cookie
//     // const userId = getUserId(req);
//       const token =
//         req.cookies?.accessToken ||
//         req.cookies?.refreshToken ||
//         req.cookies?.token;

//     if (!token) return res.status(401).json({ message: "Auth missing" });

//     const payload = verifyRefreshToken(token);

//     const userId = payload.id;

//     console.log('👤 userId:', userId)
//     console.log('🔑 code:', code ? code.substring(0, 20) + '...' : 'MISSING')
//     if (!userId) {
//         return res.status(401).json({ success: false, message: "User not found or not authenticated" });
//     }
//     if (!code) {
//         return res.status(400).json({ success: false, message: "`code` is required" });
//     }

//     const FB_GRAPH = "https://graph.facebook.com/v19.0";

//     try {
//         console.log('📡 Exchanging code for token...')
//         // 1. Exchange short-lived code for a user access token
//         const { data: tokenData } = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
//             params: {
//                 // client_id: config.META_APP_ID,
//                 // client_secret: config.META_APP_SECRET,
//                 client_id: config.META_WHATSAPP_APP_ID,
//                 client_secret: config.META_WHATSAPP_APP_SECRET,
//                 code,
//             },
//         });
//          console.log('🎟️ tokenData:', JSON.stringify(tokenData))
//         const access_token = tokenData.access_token;

//         if (!access_token) {
//             console.error("[connectEmbeddedWhatsapp] No access_token in response:", tokenData);
//             return res.status(400).json({ success: false, message: "Failed to obtain access token from Meta" });
//         }
//  console.log('✅ Got access_token')
//         console.log('📡 Fetching businesses...')
//         // 2. Fetch all businesses + their WABAs
//         const { data: bizData } = await axios.get(`${FB_GRAPH}/me/businesses`, {
//             params: {
//                 access_token,
//                 fields: "id,name,owned_whatsapp_business_accounts{id,name}",
//             },
//         });
//         console.log('🏢 bizData:', JSON.stringify(bizData))

//         const registered = [];

//         for (const business of bizData.data || []) {
//             console.log('🏢 Processing business:', business.id, business.name)
//             const wabas = business.owned_whatsapp_business_accounts?.data || [];
//             console.log('📱 WABAs count:', wabas.length)

//             for (const waba of wabas) {
//                 // 3. Subscribe the WABA to your app using the system user token
//                 await axios
//                     .post(
//                         `${FB_GRAPH}/${waba.id}/subscribed_apps`,
//                         {},
//                         { params: { access_token: config.META_WHATSAPP_SYSTEM_USER_TOKEN } }
//                     )
//                     .catch((e) =>
//                         console.warn("[connectEmbeddedWhatsapp] Subscribe warning for WABA", waba.id, ":", e.response?.data)
//                     );

//                 // 4. Fetch phone numbers attached to this WABA
//                 const { data: phoneData } = await axios.get(`${FB_GRAPH}/${waba.id}/phone_numbers`, {
//                     params: {
//                         access_token,
//                         fields: "id,display_phone_number,verified_name,status,quality_rating,messaging_limit_tier",
//                     },
//                 });
//                 console.log('📞 phoneData:', JSON.stringify(phoneData))
//                 for (const phone of phoneData.data || []) {
//                     // 5. Persist to your DB
//                     try {
//                         await saveWhatsAppNumber(userId, {
//                             phoneNumberId: phone.id,
//                             wabaId: waba.id,
//                             displayName: phone.verified_name || phone.display_phone_number,
//                             phoneNumber: phone.display_phone_number,
//                             accessToken: access_token,
//                             status: phone.status?.toLowerCase() || "active",
//                             qualityRating: phone.quality_rating || "UNKNOWN",
//                             messagingLimit: phone.messaging_limit_tier || "TIER_1K",
//                         });

//                         // 6. Optionally register with MSG91 if you use it
//                         if (config.MSG91_AUTHKEY) {
//                             await axios
//                                 .post(
//                                     "https://api.msg91.com/api/v5/whatsapp/add-number",
//                                     { waba_id: waba.id, phone_number_id: phone.id },
//                                     {
//                                         headers: {
//                                             authkey: config.MSG91_AUTHKEY,
//                                             "Content-Type": "application/json",
//                                         },
//                                     }
//                                 )
//                                 .catch((msg91Err) =>
//                                     console.warn(
//                                         `[connectEmbeddedWhatsapp] MSG91 warning for ${phone.display_phone_number}:`,
//                                         msg91Err.response?.data
//                                     )
//                                 );
//                         }

//                         registered.push({
//                             waba_id: waba.id,
//                             phone_number_id: phone.id,
//                             display_phone_number: phone.display_phone_number,
//                             status: "connected",
//                         });

//                         console.log(
//                             `[connectEmbeddedWhatsapp] Saved ${phone.display_phone_number} for user ${userId}`
//                         );
//                     } catch (saveErr) {
//                         console.error(
//                             `[connectEmbeddedWhatsapp] DB save failed for ${phone.display_phone_number}:`,
//                             saveErr.message
//                         );
//                         registered.push({
//                             waba_id: waba.id,
//                             phone_number_id: phone.id,
//                             display_phone_number: phone.display_phone_number,
//                             status: "failed",
//                             error: saveErr.message,
//                         });
//                     }
//                 }
//             }
//         }

//         if (registered.length === 0) {
//             return res.status(200).json({
//                 success: true,
//                 message: "No phone numbers found under your WhatsApp Business accounts.",
//                 connected_numbers: [],
//             });
//         }
//  console.log('✅ Final registered:', JSON.stringify(registered))
//         return res.status(200).json({ success: true, connected_numbers: registered });

//     } catch (error) {
//         console.error("[connectEmbeddedWhatsapp] Fatal error:", error.response?.data || error.message);
//         return res.status(500).json({
//             success: false,
//             message: "Connection failed",
//             error: error.response?.data?.error?.message || error.message,
//         });
//     }
// };

// export const connectEmbeddedWhatsapp = async (req, res) => {
//   console.log("connectEmbeddedWhatsapp called");
//   console.log("Body:", JSON.stringify(req.body));

//   const { code, wabaId, phoneNumberId } = req.body;

//   const userId = req.user?.id || req.user?._id;

//   console.log("👤 userId:", userId);
//   console.log("🔑 code:", code ? code.substring(0, 20) + "..." : "MISSING");
//   console.log("📱 wabaId:", wabaId);

//   if (!userId)
//     return res
//       .status(401)
//       .json({ success: false, message: "User not authenticated" });
//   if (!code)
//     return res
//       .status(400)
//       .json({ success: false, message: "code is required" });
//   if (!wabaId)
//     return res
//       .status(400)
//       .json({ success: false, message: "wabaId is required" });

//   const FB_GRAPH = "https://graph.facebook.com/v21.0";

//   try {
//     // 1. Code → Access Token
//     console.log("📡 Exchanging code for token...");
//     const tokenData = await MetaGraphClient.exchangeCodeForToken(code);
//     console.log("🎟️ tokenData:", JSON.stringify(tokenData));

//     const access_token = tokenData.access_token;
//     if (!access_token) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Failed to get access token" });
//     }
//     console.log("✅ Got access_token");

//     // 2. WABA subscribe
//     try {
//         await MetaGraphClient.subscribeWabaToApp(wabaId, config.META_WHATSAPP_SYSTEM_USER_TOKEN);
//     } catch (e) {
//         console.warn("Subscribe warning:", e.message);
//     }

//     // 3. Phone numbers — wabaId seedha use karo, me/businesses nahi
//     console.log("📡 Fetching phone numbers for wabaId:", wabaId);
//     const phoneData = await MetaGraphClient.fetchWabaPhoneNumbers(wabaId, access_token);
//     console.log("📞 phoneData:", JSON.stringify(phoneData));

//     const registered = [];

//     for (const phone of phoneData || []) {
//       try {
//         await saveWhatsAppNumber(userId, {
//           phoneNumberId: phone.id,
//           wabaId,
//           displayName: phone.verified_name || phone.display_phone_number,
//           phoneNumber: phone.display_phone_number,
//           accessToken: access_token,
//           status: phone.status?.toLowerCase() || "active",
//           qualityRating: phone.quality_rating || "UNKNOWN",
//           messagingLimit: phone.messaging_limit_tier || "TIER_1K",
//         });

//         registered.push({
//           waba_id: wabaId,
//           phone_number_id: phone.id,
//           display_phone_number: phone.display_phone_number,
//           status: "connected",
//         });

//         console.log(
//           `✅ Saved ${phone.display_phone_number} for user ${userId}`,
//         );
//       } catch (saveErr) {
//         console.error(`❌ DB save failed:`, saveErr.message);
//         registered.push({
//           waba_id: wabaId,
//           phone_number_id: phone.id,
//           display_phone_number: phone.display_phone_number,
//           status: "failed",
//           error: saveErr.message,
//         });
//       }
//     }

//     console.log("✅ Final registered:", JSON.stringify(registered));
//     return res
//       .status(200)
//       .json({ success: true, connected_numbers: registered });
//   } catch (error) {
//     console.error("Fatal error:", error.message);
//     return res.status(error.statusCode || 500).json({
//       success: false,
//       message: "Connection failed",
//       error: error.message,
//       metaCode: error.metaCode,
//       metaTraceId: error.metaFbTraceId
//     });
//   }
// };

export const testCreditLineId = async (req, res, next) => {
  try {
    console.log("[testCreditLineId] API Hit");
    
    const businessId = config.META_BORADE_AI_BUSINESS_ID;
    const systemToken = config.META_WHATSAPP_SYSTEM_USER_TOKEN;
    
    console.log(`[testCreditLineId] Using Business ID: ${businessId}`);
    
    if (!businessId) {
      console.warn("[testCreditLineId] Missing Business ID");
      return res.status(400).json({ success: false, message: 'businessId is required (query/body/env)' });
    }

    // Using global fetch (Node 18+) or axios if preferred. We'll use fetch as requested.
    console.log(`[testCreditLineId] Fetching extended credits from Meta Graph API v21.0...`);
    const resp = await fetch(
      `https://graph.facebook.com/v21.0/${businessId}/extendedcredits?access_token=${systemToken}`
    );
    const data = await resp.json();
    
    console.log(`[testCreditLineId] Raw Response from Meta:`, JSON.stringify(data, null, 2));
    
    let creditLineId = null;
    if (data.data && data.data.length > 0) {
      creditLineId = data.data[0].id;
      console.log(`[testCreditLineId] Found Credit Line ID: ${creditLineId}`);
    } else {
      console.log(`[testCreditLineId] No extended credits found in data array.`);
    }
    
    return res.status(200).json({
      success: true,
      creditLineId: creditLineId,
      raw_response: data
    });
  } catch (err) {
    console.error('[testCreditLineId] Catch Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

