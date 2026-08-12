import { Worker } from 'bullmq';
import { exchangeCodeForToken, subscribeWABAToWebhook, getPhoneNumbers, shareCreditLine, getCreditLineId, getAllAccessibleWabas } from '../services/metaWhatsapp.onboarding.service.js';
import WhatsAppToken from '../models/metaWhatsappCampaignTokenSchema.js';
import mongoose from 'mongoose';
import config from '../../config/config.js';
import redisClient from '../../config/redis.js';

const worker = new Worker('whatsapp-onboarding', async (job) => {
  const { userId, code, wabaId, phoneNumberId } = job.data;
  console.log(`[WhatsApp Onboarding Worker] Processing job for user ${userId} | WABA: ${wabaId}`);

  try {
    // 1. Exchange code for access token (Customer Token)
    let accessToken = null;
    if (code) {
      accessToken = await exchangeCodeForToken(code);
    } else {
      accessToken = config.META_WHATSAPP_SYSTEM_USER_TOKEN || config.META_WHATSAPP_ACCESS_TOKEN;
    }

    // 2. Discover all accessible WABAs for this user token
    let WabasToProcess = [];
    if (wabaId) {
      WabasToProcess.push({ id: wabaId, name: 'Selected WABA' });
    }

    try {
      console.log(`[WhatsApp Onboarding Worker] Discovering all accessible WABAs...`);
      const discoveredWabas = await getAllAccessibleWabas(accessToken);
      for (const dw of discoveredWabas) {
        if (!WabasToProcess.some(w => w.id === dw.id)) {
          WabasToProcess.push(dw);
        }
      }
    } catch (err) {
      console.error(`[WhatsApp Onboarding Worker] Error discovering WABAs:`, err.message);
    }

    console.log(`[WhatsApp Onboarding Worker] WABAs to process:`, WabasToProcess.map(w => `${w.name} (${w.id})`).join(', '));

    for (const waba of WabasToProcess) {
      console.log(`[WhatsApp Onboarding Worker] Processing WABA: ${waba.name} (${waba.id})`);

      // Subscribe webhook
      try {
        await subscribeWABAToWebhook(waba.id, accessToken);
      } catch (subErr) {
        console.error(`[WhatsApp Onboarding Worker] Failed to subscribe WABA ${waba.id}:`, subErr.message);
      }

      // Get phone number details
      let phoneNumbers = [];
      try {
        phoneNumbers = await getPhoneNumbers(waba.id, accessToken);
        console.log(`[WhatsApp Onboarding Worker] Phone numbers for WABA ${waba.id} from Meta API:`, JSON.stringify(phoneNumbers, null, 2));
      } catch (phoneErr) {
        console.error(`[WhatsApp Onboarding Worker] Failed to fetch phone numbers for WABA ${waba.id}:`, phoneErr.message);
        continue;
      }

      // Share credit line
      let creditAllocationId = null;
      let creditLineId = null;
      
      try {
        console.log(`[WhatsApp Onboarding Worker] Fetching Credit Line ID...`);
        creditLineId = await getCreditLineId();
      } catch (err) {
        console.error(`[WhatsApp Onboarding Worker] Warning: Failed to fetch credit line ID:`, err.message);
      }
      
      if (creditLineId) {
        console.log(`[WhatsApp Onboarding Worker] Sharing credit line ${creditLineId} with WABA ${waba.id}`);
        try {
          const creditAllocation = await shareCreditLine(creditLineId, waba.id);
          creditAllocationId = creditAllocation?.allocation_config_id || null;
          console.log(`[WhatsApp Onboarding Worker] Credit line shared successfully. Allocation ID: ${creditAllocationId}`);
        } catch (err) {
          console.error(`[WhatsApp Onboarding Worker] Warning: Failed to share credit line, continuing onboarding...`, err.message);
        }
      } else {
        console.warn(`[WhatsApp Onboarding Worker] No Credit Line ID found. Skipping credit line sharing.`);
      }

      // Save everything to DB
      for (const number of phoneNumbers) {
        // If a specific phoneNumberId was provided for the selected WABA, honor it. Otherwise, save all numbers.
        if (waba.id === wabaId && phoneNumberId && number.id !== phoneNumberId) continue;

        await WhatsAppToken.findOneAndUpdate(
          { phoneNumberId: number.id },
          {
            $set: {
              userId: new mongoose.Types.ObjectId(userId),
              phoneNumberId: number.id,
              wabaId: waba.id,
              displayName: number.verified_name || number.display_phone_number,
              phoneNumber: number.display_phone_number.replace(/\D/g, ''),
              accessToken: accessToken,
              creditAllocationId: creditAllocationId,
              status: "active",
              qualityRating: number.quality_rating || "UNKNOWN",
              messagingLimit: number.messaging_limit_tier || "TIER_1K",
              connectedAt: new Date(),
            },
            $setOnInsert: {
              label: "",
              isPrimary: false,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`[WhatsApp Onboarding Worker] Saved phone number: ${number.display_phone_number} (ID: ${number.id}) for WABA: ${waba.name}`);
      }
    }

    console.log(`[WhatsApp Onboarding Worker] Success for user ${userId}`);
    return { success: true };
  } catch (err) {
    console.error(`[WhatsApp Onboarding Worker] Error:`, err.message);
    throw err;
  }
}, { connection: redisClient });

worker.on('failed', (job, err) => {
  console.error(`[WhatsApp Onboarding Worker] Job ${job.id} failed with error: ${err.message}`);
});

export default worker;
