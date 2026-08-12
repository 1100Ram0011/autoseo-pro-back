import axios from "axios";
import config from "../../config/config.js";

const FB_GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Centralized Meta Request Handler with built-in Error Parsing.
 * All HTTP requests to Meta's Graph API should go through this function.
 *
 * @param {Object} params
 * @param {string} params.method - HTTP method (GET, POST, DELETE, etc.)
 * @param {string} params.path - API path or full URL
 * @param {Object} [params.data] - Request body
 * @param {Object} [params.params] - URL query parameters
 * @param {string} params.accessToken - Meta Access Token
 * @param {Object} [params.headers] - Additional custom headers
 * @returns {Promise<any>} The response data from Meta
 */
const metaRequest = async ({
  method = "GET",
  path,
  data,
  params,
  accessToken,
  headers = {},
}) => {
  try {
    const url = path.startsWith("http") ? path : `${FB_GRAPH}/${path}`;

    const response = await axios({
      method,
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...headers,
      },
      data,
      params,
    });

    // console.log("whatsapp response data ", response.data);

    return response.data;
  } catch (err) {
    // Robust Error Handling for all Meta API calls
    const metaError = err.response?.data?.error;
    if (metaError) {
      const errorMsg =
        metaError.error_user_msg ||
        metaError.error_user_title ||
        metaError.error_data?.details ||
        metaError.message ||
        "Meta API Error";
      const error = new Error(errorMsg);
      error.metaCode = metaError.code;
      error.metaSubcode = metaError.error_subcode;
      error.metaType = metaError.type;
      error.metaFbTraceId = metaError.fbtrace_id;
      error.metaUserMsg = metaError.error_user_msg;
      error.metaUserTitle = metaError.error_user_title;
      error.statusCode = err.response?.status;
      throw error;
    }

    // If it's not a standard Meta error format, throw the original axios error
    throw err;
  }
};

/**
 * MetaGraphClient
 * ─────────────────────────────────────────────────────────────
 * A centralized, global client for interacting with Meta Graph API.
 * Keeps controllers and services DRY and decouples them from axios.
 */
export const MetaGraphClient = {
  // ─── OAUTH & NUMBER MANAGEMENT ───────────────────────────────────────────

  /**
   * Exchange short-lived OAuth code for an access token
   */
  exchangeCodeForToken: async (code, redirectUri) => {
    return metaRequest({
      method: "GET",
      path: "oauth/access_token",
      params: {
        client_id: config.META_WHATSAPP_APP_ID,
        client_secret: config.META_WHATSAPP_APP_SECRET,
        redirect_uri: redirectUri, // Required if using standard OAuth flow
        code,
      },
      accessToken: "", // Not required for token exchange
    });
  },

  /**
   * Subscribe a WABA to the application (Webhook)
   */
  subscribeWabaToApp: async (wabaId, systemUserToken) => {
    return metaRequest({
      method: "POST",
      path: `${wabaId}/subscribed_apps`,
      accessToken: systemUserToken,
    });
  },

  /**
   * Fetch details for a specific phone number
   */
  getPhoneNumberDetails: async (phoneNumberId, accessToken) => {
    return metaRequest({
      method: "GET",
      path: phoneNumberId,
      params: {
        fields:
          "id,display_phone_number,verified_name,status,quality_rating,messaging_limit_tier",
      },
      accessToken,
    });
  },

  /**
   * Fetch all phone numbers attached to a specific WABA
   */
  fetchWabaPhoneNumbers: async (wabaId, accessToken) => {
    const data = await metaRequest({
      method: "GET",
      path: `${wabaId}/phone_numbers`,
      params: {
        fields:
          "id,display_phone_number,verified_name,status,quality_rating,messaging_limit_tier",
      },
      accessToken,
    });
    return data.data || [];
  },

  /**
   * Fetch Meta Official Template Library directly via Meta Graph API
   */
  fetchMetaTemplateLibrary: async (accessToken, options = {}) => {
    try {
      const params = {
        fields: "name,category,language,topic,industry,title,description,usecase,body,header,buttons,body_params,footer",
        limit: 100, // Reasonable limit for the library page
      };

      // Map our app's search/filter fields to Meta's expected query parameters
      if (options.search) params.name_or_content = options.search;
      if (options.category && options.category !== 'ALL') params.category = options.category.toLowerCase();
      if (options.topic && options.topic !== 'ALL') params.topic = options.topic;
      if (options.industry && options.industry !== 'ALL') params.industry = options.industry;
      // Meta might not filter perfectly by language on this endpoint, but we pass it just in case
      if (options.language) params.language = options.language;

      const data = await metaRequest({
        method: "GET",
        path: "message_template_library",
        params,
        accessToken,
      });
      return data.data || [];
    } catch (err) {
      console.log(
        `[MetaGraphClient] Template library Graph API query failed: ${err.message}`,
      );
      return [];
    }
  },

  /**
   * Fetch user profile info
   */
  getUserInfo: async (accessToken) => {
    return metaRequest({
      method: "GET",
      path: "me",
      params: { fields: "id,name" },
      accessToken,
    });
  },

  /**
   * Fetch businesses owned by the user
   */
  getUserBusinesses: async (accessToken) => {
    const data = await metaRequest({
      method: "GET",
      path: "me/businesses",
      params: { fields: "id,name" },
      accessToken,
    });
    return data.data || [];
  },

  /**
   * Fetch WABAs owned by a business
   */
  getBusinessWabas: async (businessId, accessToken) => {
    const data = await metaRequest({
      method: "GET",
      path: `${businessId}/owned_whatsapp_business_accounts`,
      params: { fields: "id,name" },
      accessToken,
    });
    return data.data || [];
  },

  /**
   * Fetch WABA details (e.g. name)
   */
  getWabaDetails: async (wabaId, accessToken) => {
    return metaRequest({
      method: "GET",
      path: wabaId,
      params: { fields: "id,name" },
      accessToken,
    });
  },

  // ─── MESSAGING ───────────────────────────────────────────────────────────

  /**
   * Send a template, text, or interactive message
   */
  sendMessage: async (phoneNumberId, accessToken, payload, options = {}) => {
    // Auto-inject preview_url for text messages if not already set
    if (payload.type === "text" && payload.text && payload.text.preview_url === undefined) {
      payload.text.preview_url = options.previewUrl ?? true;
    }
    return metaRequest({
      method: "POST",
      path: `${phoneNumberId}/messages`,
      data: payload,
      accessToken,
    });
  },

  // ─── MARKETING MESSAGES LITE ─────────────────────────────────────────
  sendMarketingMessage: async (phoneNumberId, accessToken, payload) => {
    return metaRequest({
      method: "POST",
      path: `${phoneNumberId}/marketing_messages`,
      data: payload,
      accessToken,
    });
  },

  // ─── TEMPLATES ───────────────────────────────────────────────────────────

  /**
   * Submit a template to Meta for approval
   */
  createTemplate: async (wabaId, accessToken, payload) => {
    return metaRequest({
      method: "POST",
      path: `${wabaId}/message_templates`,
      data: payload,
      accessToken,
    });
  },

  /**
   * Update TTL for a template
   */
  updateTemplateTTL: async (wabaId, accessToken, templateName, ttlSeconds) => {
    return metaRequest({
      method: "POST",
      path: `${wabaId}/message_templates`,
      data: {
        name: templateName,
        message_send_ttl_seconds: ttlSeconds,
      },
      accessToken,
    });
  },

  /**
   * Fetch status/metadata for templates
   */
  fetchTemplates: async (wabaId, accessToken, metaTemplateId = null) => {
    const data = await metaRequest({
      method: "GET",
      path: `${wabaId}/message_templates`,
      params: {
        fields:
          "id,name,status,category,language,components,quality_score,rejected_reason",
        ...(metaTemplateId && { id: metaTemplateId }),
      },
      accessToken,
    });
    return data.data || data || [];
  },

  /**
   * Delete a template
   */
  deleteTemplate: async (wabaId, accessToken, templateName) => {
    return metaRequest({
      method: "DELETE",
      path: `${wabaId}/message_templates`,
      params: { name: templateName },
      accessToken,
    });
  },

  // ─── BUSINESS PROFILE ─────────────────────────────────────────────────────

  // ─── PHONE NUMBER SETTINGS ──────────────────────────────────────────
  getPhoneNumberSettings: async (phoneNumberId, accessToken, params = {}) => {
    return metaRequest({
      method: "GET",
      path: `${phoneNumberId}/settings`,
      params,
      accessToken,
    });
  },

  updatePhoneNumberSettings: async (phoneNumberId, accessToken, settingsPayload) => {
    return metaRequest({
      method: "POST",
      path: `${phoneNumberId}/settings`,
      data: settingsPayload,
      accessToken,
    });
  },

  /**
   * GET /{phoneNumberId}/whatsapp_business_profile
   */
  getBusinessProfile: async (phoneNumberId, accessToken) => {
    return metaRequest({
      method: "GET",
      path: `${phoneNumberId}/whatsapp_business_profile`,
      params: {
        fields: "about,address,description,email,profile_picture_url,websites,vertical"
      },
      accessToken,
    });
  },

  /**
   * POST /{phoneNumberId}/whatsapp_business_profile
   */
  updateBusinessProfile: async (phoneNumberId, profileData, accessToken) => {
    return metaRequest({
      method: "POST",
      path: `${phoneNumberId}/whatsapp_business_profile`,
      data: { messaging_product: "whatsapp", ...profileData },
      accessToken,
    });
  },

  // ─── AUTOMATION (ICE BREAKERS & COMMANDS) ────────────────────────────────

  /**
   * Fetch conversational automation settings (Ice breakers, commands)
   */
  getConversationalAutomation: async (phoneNumberId, accessToken) => {
    const data = await metaRequest({
      method: "GET",
      path: phoneNumberId,
      params: { fields: "conversational_automation" },
      accessToken,
    });
    return data;
  },

  /**
   * Update conversational automation settings (Ice breakers, commands)
   * Official Endpoint: POST /{Phone-Number-ID}/conversational_automation
   */
  updateConversationalAutomation: async (
    phoneNumberId,
    accessToken,
    payload,
  ) => {
    try {
      console.log(`[Meta Client] Attempting POST /${phoneNumberId}/conversational_automation with payload:`, JSON.stringify(payload, null, 2));
      const res = await metaRequest({
        method: "POST",
        path: `${phoneNumberId}/conversational_automation`,
        data: payload,
        accessToken,
      });
      console.log(`[Meta Client] Primary endpoint success:`, JSON.stringify(res, null, 2));
      return res;
    } catch (err) {
      console.error(`[Meta Client] Primary endpoint failed. Error:`, err.message, err.response?.data);
      console.log(`[Meta Client] Falling back to POST /${phoneNumberId} with conversational_automation object...`);
      return await metaRequest({
        method: "POST",
        path: phoneNumberId,
        data: { conversational_automation: payload },
        accessToken,
      });
    }
  },

  // ─── ANALYTICS ────────────────────────────────────────────────────────────

  /**
   * Fetch conversation analytics from WABA
   * GET /{WABA-ID}?fields=conversation_analytics.start().end().granularity().dimensions()
   */
  getConversationAnalytics: async (wabaId, accessToken, startTs, endTs, granularity = "DAILY", dimensions = []) => {
    const dimStr = dimensions.length > 0 ? `.dimensions([${dimensions.map(d => `'${d}'`).join(",")}])` : "";
    return metaRequest({
      method: "GET",
      path: wabaId,
      params: {
        fields: `conversation_analytics.start(${startTs}).end(${endTs}).granularity(${granularity})${dimStr}`,
      },
      accessToken,
    });
  },

  /**
   * Fetch message analytics from WABA
   * GET /{WABA-ID}?fields=analytics.start().end().granularity()
   */
  getMessageAnalytics: async (wabaId, accessToken, startTs, endTs, granularity = "DAILY") => {
    return metaRequest({
      method: "GET",
      path: wabaId,
      params: {
        fields: `analytics.start(${startTs}).end(${endTs}).granularity(${granularity})`,
      },
      accessToken,
    });
  },

  /**
   * Fetch marketing template insights for a phone number
   * GET /{phone-number-id}/insights
   */
  getTemplateInsights: async (phoneNumberId, accessToken, start, end) => {
    const params = {};
    if (start) params.start = start;
    if (end) params.end = end;
    return metaRequest({
      method: "GET",
      path: `${phoneNumberId}/insights`,
      params,
      accessToken,
    });
  },

  // ─── MEDIA UPLOAD SESSIONS ────────────────────────────────────────────────

  /**
   * STEP 2 of Resumable Upload for Profile Picture
   * Note: This uses raw axios because of OAuth and file_offset headers
   */
  uploadFileData: async (uploadSessionId, fileBuffer, fileType, accessToken) => {
    const url = `${FB_GRAPH}/${uploadSessionId}`;
    const response = await axios({
      method: "POST",
      url,
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": fileType,
      },
      data: fileBuffer,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return response.data; // { h: "4:HANDLE_STRING..." }
  },

  createUploadSession: async (
    appId,
    accessToken,
    fileLength,
    fileType,
    fileName,
  ) => {
    return metaRequest({
      method: "POST",
      path: `${appId}/uploads`,
      params: {
        file_name: fileName,
        file_length: fileLength,
        file_type: fileType,
        access_token: accessToken,
      },
      accessToken, // though passed in params as well
    });
  },

  uploadMediaToSession: async (
    uploadSessionId,
    accessToken,
    fileBuffer,
    fileType,
  ) => {
    return metaRequest({
      method: "POST",
      path: uploadSessionId,
      headers: {
        Authorization: `OAuth ${accessToken}`,
        "Content-Type": fileType,
      },
      data: fileBuffer,
      accessToken,
    });
  },
};

export default MetaGraphClient;
