import config from "../../config/config.js";
import MetaGraphClient from "./metaFbWhatsapp.client.js";

// ─── BUILD OAUTH URL ──────────────────────────────────────────────────────────
export function buildOAuthURL(userId) {
    const redirectUri = `${config.BACKEND_BASE_URL}/meta/whatsapp/callback`;
    const state = Buffer.from(
        JSON.stringify(
            { userId }
        )).toString('base64');
    const scope = 'whatsapp_business_management,whatsapp_business_messaging,business_management,public_profile';
    const params = new URLSearchParams({
        client_id: config.META_WHATSAPP_APP_ID,
        redirect_uri: redirectUri,
        scope,
        state,
        response_type: 'code',
    });
    return `https://www.facebook.com/dialog/oauth?${params.toString()}`;
}

// ─── EXCHANGE CODE FOR TOKEN ──────────────────────────────────────────────────
export async function exchangeCodeForToken(code) {
    const redirectUri = `${config.BACKEND_BASE_URL}/meta/whatsapp/callback`;
    console.log('[OAuth] Exchanging code, redirectUri:', redirectUri);

    try {
        // Short-lived user token
        const tokenData = await MetaGraphClient.exchangeCodeForToken(code, redirectUri);
        const shortToken = tokenData.access_token;
        console.log('[OAuth] Short-lived token OK');

        // Note: The /oauth/access_token exchange for a long-lived token requires a different grant_type
        // We will just return the shortToken for now or we could add another method to the client.
        // For simplicity, returning what we get.
        return shortToken;
    } catch (err) {
        console.error('[OAuth] Token exchange failed:', err.message);
        throw err;
    }
}

// ─── GET USER INFO ────────────────────────────────────────────────────────────
export async function getUserInfo(accessToken) {
    try {
        return await MetaGraphClient.getUserInfo(accessToken);
    } catch (err) {
        console.error('[OAuth] getUserInfo error:', err.message);
        return { id: null, name: 'Unknown' };
    }
}

// ─── FETCH PHONE NUMBERS FOR A WABA ──────────────────────────────────────────
export async function fetchPhonesByWabaId(wabaId, accessToken) {
    try {
        const phones = await MetaGraphClient.fetchWabaPhoneNumbers(wabaId, accessToken);
        console.log(`[OAuth] WABA ${wabaId}: ${phones.length} phone(s)`);
        return phones;
    } catch (err) {
        console.log(`[OAuth] fetchPhones failed for WABA ${wabaId}:`, err.message);
        return [];
    }
}

// ─── BUILD NUMBER OBJECT ──────────────────────────────────────────────────────
export function buildNumber(phone, wabaId, wabaName, bizName, accessToken) {
    return {
        phoneNumberId: phone.id,
        phoneNumber: phone.display_phone_number,
        displayName: phone.verified_name || phone.display_phone_number,
        wabaId,
        wabaName: wabaName || 'My WABA',
        businessName: bizName || 'My Business',
        status: phone.status === 'CONNECTED' ? 'active' : 'pending',
        qualityRating: (phone.quality_rating || 'UNKNOWN').toUpperCase(),
        messagingLimit: phone.messaging_limit_tier || 'TIER_1K',
        accessToken,
    };
}

// ─── MAIN: FETCH ALL NUMBERS (3 approaches) ───────────────────────────────────
export async function fetchAllPhoneNumbers(userAccessToken) {

    // ── Approach A: GET /{waba-id}/phone_numbers using WABA IDs from env ─────
    // This is the CORRECT way for WhatsApp Business API
    // We get WABA IDs from: user token OR system token OR env config
    const knownWabaIds = (config.META_WHATSAPP_WABA_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);

    if (knownWabaIds.length > 0) {
        console.log('[OAuth] Approach A: known WABA IDs from env:', knownWabaIds);
        const numbers = [];
        for (const wabaId of knownWabaIds) {
            // Try user token first
            let phones = await fetchPhonesByWabaId(wabaId, userAccessToken);
            let tokenUsed = userAccessToken;

            // Fallback to system token
            if (!phones.length && config.META_WHATSAPP_SYSTEM_USER_TOKEN) {
                phones = await fetchPhonesByWabaId(wabaId, config.META_WHATSAPP_SYSTEM_USER_TOKEN);
                tokenUsed = config.META_WHATSAPP_SYSTEM_USER_TOKEN;
            }

            // Get WABA name
            let wabaName = 'My WABA';
            try {
                const wabaDetails = await MetaGraphClient.getWabaDetails(wabaId, tokenUsed);
                wabaName = wabaDetails.name || wabaName;
            } catch { }

            console.log("phones", phones);

            phones.forEach(p => numbers.push(buildNumber(p, wabaId, wabaName, 'My Business', tokenUsed)));
        }
        if (numbers.length > 0) {
            console.log('[OAuth] Approach A success:', numbers.length, 'numbers');
            return numbers;
        }
    }

    // ── Approach B: GET /me/businesses → get owned WABAs ─────────────────────
    // NOTE: Do NOT request whatsapp_business_accounts as a field — it's a separate query
    console.log('[OAuth] Approach B: /me/businesses');
    try {
        const businesses = await MetaGraphClient.getUserBusinesses(userAccessToken);
        console.log('[OAuth] Approach B: businesses found:', businesses.length);

        const numbers = [];
        for (const biz of businesses) {
            // For each business, get its WABAs separately
            try {
                const wabas = await MetaGraphClient.getBusinessWabas(biz.id, userAccessToken);
                for (const waba of wabas) {
                    const phones = await fetchPhonesByWabaId(waba.id, userAccessToken);
                    phones.forEach(p => numbers.push(buildNumber(p, waba.id, waba.name, biz.name, userAccessToken)));
                }
            } catch (err) {
                console.log('[OAuth] Approach B WABA fetch for biz', biz.id, ':', err.message);
            }
        }

        if (numbers.length > 0) {
            console.log('[OAuth] Approach B success:', numbers.length, 'numbers');
            return numbers;
        }
    } catch (err) {
        console.log('[OAuth] Approach B failed:', err.message);
    }

    // ── Approach C: System token + all accessible WABAs ───────────────────────
    if (process.env.META_SYSTEM_USER_TOKEN) {
        console.log('[OAuth] Approach C: system token WABAs');
        try {
            const businesses = await MetaGraphClient.getUserBusinesses(process.env.META_SYSTEM_USER_TOKEN);
            const numbers = [];
            for (const biz of businesses) {
                try {
                    const wabas = await MetaGraphClient.getBusinessWabas(biz.id, process.env.META_SYSTEM_USER_TOKEN);
                    for (const waba of wabas) {
                        const phones = await fetchPhonesByWabaId(waba.id, process.env.META_SYSTEM_USER_TOKEN);
                        phones.forEach(p => numbers.push(buildNumber(p, waba.id, waba.name, biz.name, process.env.META_SYSTEM_USER_TOKEN)));
                    }
                } catch { }
            }
            if (numbers.length > 0) {
                console.log('[OAuth] Approach C success:', numbers.length, 'numbers');
                return numbers;
            }
        } catch (err) {
            console.log('[OAuth] Approach C failed:', err.message);
        }
    }

    console.log('[OAuth] All approaches returned 0 numbers');
    return [];
}

// ─── FETCH NUMBERS FOR MANUALLY ENTERED WABA ID ──────────────────────────────
export async function fetchNumbersForWabaId(wabaId, userAccessToken) {
    console.log('[OAuth] Manual WABA fetch:', wabaId);
    let phones = await fetchPhonesByWabaId(wabaId, userAccessToken);
    let token = userAccessToken;
    if (!phones.length && config.META_WHATSAPP_SYSTEM_USER_TOKEN) {
        phones = await fetchPhonesByWabaId(wabaId, config.META_WHATSAPP_SYSTEM_USER_TOKEN);
        token = config.META_WHATSAPP_SYSTEM_USER_TOKEN;
    }
    return phones.map(p => buildNumber(p, wabaId, 'My WABA', 'My Business', token));
}
