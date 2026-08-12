import config from "../../config/config.js";
import { MetaGraphClient } from "./metaFbWhatsapp.client.js";

/**
 * Exchanges the code received from Embedded Signup for a User Access Token.
 */
export const exchangeCodeForToken = async (code) => {
  try {
    const data = await MetaGraphClient.exchangeCodeForToken(code);
    console.log("[Token] Exchanged code for token:", data.access_token);
    return data.access_token;
  } catch (err) {
    throw new Error(err.message || 'Failed to exchange code for token');
  }
};

/**
 * Subscribes a WABA to the App's Webhook.
 */
export const subscribeWABAToWebhook = async (wabaId, accessToken) => {
  try {
    const token = accessToken || config.META_WHATSAPP_SYSTEM_USER_TOKEN;
    const data = await MetaGraphClient.subscribeWabaToApp(wabaId, token);
    return data;
  } catch (err) {
    console.error(`[WhatsApp Onboarding] Webhook subscribe failed for ${wabaId}:`, err.message);
    throw err;
  }
};

/**
 * Subscribes a WABA to the App's Webhook.
 */
// (Note: Retaining header/doc comments for clarity)
/**
 * Fetches Phone Number details for a specific WABA ID.
 */
export const getPhoneNumbers = async (wabaId, accessToken) => {
  try {
    const token = accessToken || config.META_WHATSAPP_SYSTEM_USER_TOKEN;
    const data = await MetaGraphClient.fetchWabaPhoneNumbers(wabaId, token);
    return data; // fetchWabaPhoneNumbers already returns data.data
  } catch (err) {
    throw new Error(err.message || 'Failed to fetch phone numbers');
  }
};

/**
 * Fetches all WABA IDs the access token has access to by querying user's businesses.
 */
export const getAllAccessibleWabas = async (accessToken) => {
  try {
    const businesses = await MetaGraphClient.getUserBusinesses(accessToken);
    console.log(`[WhatsApp Onboarding] Found ${businesses.length} businesses for this user`);
    
    const WabasList = [];
    for (const biz of businesses) {
      try {
        const bizWabas = await MetaGraphClient.getBusinessWabas(biz.id, accessToken);
        console.log(`[WhatsApp Onboarding] Business ${biz.name} (${biz.id}) has ${bizWabas.length} WABAs`);
        for (const waba of bizWabas) {
          WabasList.push({
            id: waba.id,
            name: waba.name,
            businessName: biz.name
          });
        }
      } catch (bizErr) {
        console.warn(`[WhatsApp Onboarding] Failed to get WABAs for business ${biz.id}:`, bizErr.message);
      }
    }
    return WabasList;
  } catch (err) {
    console.warn(`[WhatsApp Onboarding] Failed to get user businesses:`, err.message);
    return [];
  }
};


/**
 * Fetches the Credit Line ID for the Business
 */
export const getCreditLineId = async () => {
  try {
    const businessId = config.META_BORADE_AI_BUSINESS_ID;
    const token = config.META_WHATSAPP_SYSTEM_USER_TOKEN || config.META_WHATSAPP_ACCESS_TOKEN;
    
    if (!businessId) throw new Error('META_BORADE_AI_BUSINESS_ID is not set in config');

    const resp = await fetch(
      `https://graph.facebook.com/v21.0/${businessId}/extendedcredits?access_token=${token}`
    );
    const data = await resp.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    if (data.data && data.data.length > 0) {
      return data.data[0].id;
    } else {
      throw new Error('No credit line found for this business ID');
    }
  } catch (err) {
    console.error(`[getCreditLineId] Failed:`, err.message);
    throw err;
  }
};

/**
 * Shares the extended credit line with the client WABA
 */
export const shareCreditLine = async (creditLineId, wabaId) => {
  try {
    if (!creditLineId) throw new Error('No Credit Line ID provided');
    const token = config.META_WHATSAPP_SYSTEM_USER_TOKEN || config.META_WHATSAPP_ACCESS_TOKEN;
    
    console.log(`[shareCreditLine] Attaching WABA ${wabaId} to Credit Line ${creditLineId}...`);
    
    // Using global fetch (Node 18+)
    const resp = await fetch(
      `https://graph.facebook.com/v21.0/${creditLineId}/whatsapp_credit_sharing_and_attach`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          waba_id: wabaId,
          waba_currency: 'INR',
          access_token: token
        })
      }
    );
    const data = await resp.json();
    
    if (data.error) {
      console.error(`[shareCreditLine] Meta Error:`, data.error);
      throw new Error(data.error.message);
    }
    
    return data;
  } catch (err) {
    console.error(`[shareCreditLine] Failed for WABA ${wabaId}:`, err.message);
    throw err;
  }
};

