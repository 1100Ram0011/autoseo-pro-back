import axios from "axios";
import config from "../config/config.js";
import logger from "../config/logger.js";

// ✅ Correct base URL from official MSG91 docs
const MSG91_BASE_URL = "https://api.msg91.com/api/v5";
const MSG91_AUTH_KEY = config.MSG91_AUTHKEY;

/**
 * Strip leading + and whitespace.
 * MSG91 wants plain numbers with country code: "919876543210"
 */
const normalizePhone = (phone) =>
    String(phone).trim().replace(/\s+/g, "").replace(/^\+/, "");

/**
 * Build the `components` object per MSG91 API spec.
 *
 * Supports all template types from the official docs:
 *  - Header: NONE | TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
 *  - Body variables: body_1, body_2 ... body_N
 *  - Buttons: url (CTA), COPY_CODE (coupon), CATALOG, MPM
 *  - Carousel cards: card_0_header_1, card_1_header_1 ...
 *
 * NOTE from docs: "If header or body has no variable, don't include
 * that component in the payload at all."
 *
 * @param {Object} variables  All per-recipient variables passed from the campaign
 *   Shape: {
 *     // Body
 *     body_1: "value",
 *     body_2: "value",
 *
 *     // Header - TEXT
 *     header_text: "value",
 *
 *     // Header - IMAGE / VIDEO / DOCUMENT
 *     header_url: "https://...",
 *     header_filename: "invoice.pdf",   // document only
 *
 *     // Header - LOCATION
 *     header_latitude:  "28.6139",
 *     header_longitude: "77.2090",
 *     header_name:      "New Delhi",
 *     header_address:   "India Gate, New Delhi",
 *
 *     // Button - CTA URL variable
 *     button_1_url: "promo2024",
 *
 *     // Button - Coupon code
 *     button_1_coupon: "SAVE20",
 *
 *     // Button - Catalogue
 *     button_1_catalog_id: "prod_123",
 *
 *     // Carousel card headers (card index 0-based)
 *     card_0_header_url: "https://img1.jpg",
 *     card_1_header_url: "https://img2.jpg",
 *   }
 *
 * @param {Object} header   Template header config from DB: { type, value, filename? }
 * @param {Array}  buttons  Template buttons from DB: [{ index, subtype, type }]
 * @param {Array}  cards    Carousel cards from DB:   [{ index, mediaType }]
 *
 * @returns {Object} MSG91 components object
 */
const buildComponents = (variables = {}, header = {}, buttons = [], cards = []) => {
    const components = {};

    // ── Header ──────────────────────────────────────────────────────────────
    const headerType = header?.type?.toUpperCase();

    if (headerType && headerType !== "NONE") {
        // Fallback to mediaUrl or text from DB if variable is not provided dynamically
        const fallbackUrl = header.mediaUrl || header.value;
        const fallbackText = header.text || header.value;

        switch (headerType) {

            case "TEXT":
                // MSG91 will throw "expected number of params (0)" if we send header_1 for a static text header
                // Only send header_1 if the template header text contains a placeholder like {{1}}
                if (fallbackText && fallbackText.includes("{{1}}")) {
                    if (variables.header_text || fallbackText) {
                        components["header_1"] = {
                            type: "text",
                            value: String(variables.header_text || fallbackText),
                        };
                    }
                }
                break;

            case "IMAGE":
            case "VIDEO":
            case "DOCUMENT": {
                const finalDocUrl = variables.header_url || fallbackUrl;
                if (!finalDocUrl) throw new Error("Missing required Media URL for Global Header");
                
                components["header_1"] = {
                    type: headerType.toLowerCase(),
                    value: finalDocUrl,
                    ...(variables.header_filename || header.filename
                        ? { filename: variables.header_filename || header.filename }
                        : {}),
                };
                break;
            }

            case "LOCATION":
                // Location uses 4 separate component keys
                if (variables.header_latitude) {
                    components["header_1_latitude"] = {
                        type: "location",
                        value: String(variables.header_latitude),
                    };
                }
                if (variables.header_longitude) {
                    components["header_1_longitude"] = {
                        type: "location",
                        value: String(variables.header_longitude),
                    };
                }
                if (variables.header_name) {
                    components["header_1_name"] = {
                        type: "location",
                        value: String(variables.header_name),
                    };
                }
                if (variables.header_address) {
                    components["header_1_address"] = {
                        type: "location",
                        value: String(variables.header_address),
                    };
                }
                break;

            default:
                break;
        }
    }

    // ── Body variables: body_1, body_2 ... body_N ───────────────────────────
    Object.entries(variables).forEach(([key, value]) => {
        if (key.startsWith("body_") && value !== undefined && value !== null) {
            components[key] = {
                type: "text",
                value: String(value).trim() || " ",
            };
        }
    });

    // ── Buttons ─────────────────────────────────────────────────────────────
    // buttons array from template DB tells us what kind each button is
    // variables supply the dynamic values per recipient
    (buttons || []).forEach((btn) => {
        const key = `button_${btn.index}`; // button_1, button_2 ...

        switch (btn.subtype?.toUpperCase()) {

            case "URL":
                // CTA visit website — dynamic URL suffix or click-tracked
                if (variables[`${key}_url`] !== undefined) {
                    components[key] = {
                        subtype: "url",
                        type: "text",
                        value: String(variables[`${key}_url`]),
                    };
                }
                break;

            case "COPY_CODE":
                // Copy offer code button
                if (variables[`${key}_coupon`] || btn.couponCode) {
                    components[key] = {
                        type: "coupon_code",
                        coupon_code: variables[`${key}_coupon`] || btn.couponCode,
                        subtype: "COPY_CODE",
                    };
                }
                break;

            case "CATALOG":
                // Single product catalogue
                if (variables[`${key}_catalog_id`] || btn.catalogId) {
                    components[key] = {
                        subtype: "CATALOG",
                        type: "action",
                        value: variables[`${key}_catalog_id`] || btn.catalogId,
                    };
                }
                break;

            case "MPM":
                // Multiple product catalogue — value is complex object
                if (btn.mpmValue) {
                    components[key] = {
                        subtype: "MPM",
                        type: "action",
                        value: btn.mpmValue,
                    };
                }
                break;

            case "QUICK_REPLY":
                // Quick reply payload mapping
                if (btn.payload) {
                    components[key] = {
                        subtype: "quick_reply",
                        type: "payload",
                        value: btn.payload
                    };
                }
                break;

            default:
                break;
        }
    });

    // ── Carousel card headers and bodies ────────────────────────────────────
    (cards || []).forEach((card, i) => {
        // card index in UI might not match array index if elements were deleted. Use array index `i` as MSG91 uses sequential indices: card_0, card_1, etc.
        const cIdx = i; 
        
        // Header
        const cardKey = `card_${cIdx}_header_1`;
        const urlVar = `card_${cIdx}_header_url`;
        const fallbackUrl = card.header?.mediaUrl || card.value;
        const cType = (card.header?.type || card.mediaType || "image").toLowerCase();

        if (cType !== "none") {
            let finalCardUrl = variables[urlVar] || fallbackUrl;
            
            // Fix MSG91 Template Sync bug where they return multiple Media Handles separated by \n
            if (finalCardUrl && typeof finalCardUrl === 'string') {
                finalCardUrl = finalCardUrl.split('\n')[0].trim();
            }

            if (!finalCardUrl) {
                throw new Error(`Missing required ${cType.toUpperCase()} URL for Carousel Card ${cIdx + 1} Header`);
            }
            
            components[cardKey] = {
                type: cType,
                value: finalCardUrl,
            };
        }

        // Body variables inside cards: Card 0 Body Variable 1 -> mapped to body_1 per MSG91 Carousel API
        // Check if there are body variables dynamically passed:
        // We will loop through the variables and find any matching card_0_body_X
        Object.entries(variables).forEach(([k, v]) => {
            if (k.startsWith(`card_${cIdx}_body_`) && v !== undefined && v !== null) {
                // MSG91 uses body_1 for card 1, body_2 for card 2
                components[`body_${cIdx + 1}`] = {
                    type: "text",
                    value: String(v).trim() || " ",
                };
            }
        });

        // Carousel Button variables (URL/Payloads)
        card.buttons?.forEach((btn, bIdx) => {
            const btnKey = `card_${cIdx}_button_${bIdx + 1}`;
            if (btn.type === "QUICK_REPLY" && btn.payload) {
                components[btnKey] = {
                    subtype: "quick_reply",
                    type: "payload",
                    value: btn.payload
                };
            } else if (btn.type === "URL" && variables[`${btnKey}_url`]) {
                components[btnKey] = {
                    subtype: "url",
                    type: "text",
                    value: String(variables[`${btnKey}_url`])
                };
            }
        });
    });

    return components;
};

/**
 * Send WhatsApp messages via MSG91 bulk API.
 *
 * Full payload structure per official MSG91 docs:
 * {
 *   "integrated_number": "919876543210",
 *   "content_type": "template",
 *   "payload": {
 *     "messaging_product": "whatsapp",       ← FIRST inside payload
 *     "type": "template",
 *     "template": {
 *       "name": "template_name",
 *       "language": { "code": "en", "policy": "deterministic" },
 *       "namespace": null,                   ← required per docs
 *       "to_and_components": [
 *         {
 *           "to": ["919876543210"],
 *           "components": { ... }
 *         }
 *       ]
 *     }
 *   }
 * }
 *
 * @param {Object}  template    Full template doc from DB
 *   Expected shape: {
 *     name, language, header: { type, value, filename },
 *     buttons: [{ index, subtype, couponCode, catalogId, mpmValue }],
 *     cards:   [{ index, mediaType, value }],
 *   }
 * @param {string}  fromNumber  Integrated WABA number
 * @param {Array}   recipients  [{ phone, variables }]
 * @returns {Object}            MSG91 raw API response
 */
export const sendBulkCampaign = async (template, fromNumber, recipients) => {
    // ── Guards ────────────────────────────────────────────────────────────────
    if (!MSG91_AUTH_KEY) throw new Error("MSG91_AUTH_KEY is not configured");
    if (!fromNumber) throw new Error("fromNumber is required");
    if (!template?.name) throw new Error("template.name is required");
    if (!recipients?.length) throw new Error("No recipients provided");

    // ── Build to_and_components — one entry per recipient ─────────────────────
    const to_and_components = recipients.map((recipient) => ({
        to: [normalizePhone(recipient.phone)],
        components: buildComponents(
            recipient.variables || {},
            template.header || {},
            template.buttons || [],
            template.carouselCards || template.cards || [],
        ),
    }));

    // ── Final payload — exact structure per MSG91 official docs ───────────────
    const payload = {
        integrated_number: normalizePhone(fromNumber),
        content_type: "template",
        payload: {
            messaging_product: "whatsapp",   // ← must be first inside payload{}
            type: "template",
            template: {
                name: template.name,
                language: {
                    code: template.language || "en",
                    policy: "deterministic",
                },
                namespace: null,             // ← required per docs
                to_and_components,
            },
        },
    };

    // Always log full payload for debugging
    logger.info(
        `[MSG91] Sending — template: "${template.name}" | recipients: ${recipients.length} | from: ${normalizePhone(fromNumber)}`
    );
    logger.info(`[MSG91] Full Payload: ${JSON.stringify(payload, null, 2)}`);

    const headers = {
        "Content-Type": "application/json",
        "authkey": MSG91_AUTH_KEY,
    };

    // ── POST ──────────────────────────────────────────────────────────────────
    try {
        const response = await axios.post(
            `${MSG91_BASE_URL}/whatsapp/whatsapp-outbound-message/bulk/`,
            payload,
            {
                headers,
                timeout: 30_000,
            }
        );

        logger.info(`[MSG91] Success — HTTP ${response.status} | ` + JSON.stringify(response.data));
        return response.data;

    } catch (error) {
        const errorMsg = error.response?.data?.errors || error.response?.data?.message || "";
        
        // If MSG91 rejects because the template has STATIC headers, but we tried to pass them,
        // automatically strip the headers and retry!
        if (typeof errorMsg === 'string' && errorMsg.includes("Template does not contain title component")) {
            logger.info(`[MSG91] Template has static headers. Stripping header components and retrying...`);
            
            payload.payload.template.to_and_components.forEach(t => {
                if (t.components) {
                    Object.keys(t.components).forEach(key => {
                        if (key.startsWith("header_")) {
                            delete t.components[key];
                        }
                    });
                }
            });

            // Retry POST without headers
            const retryResponse = await axios.post(
                `${MSG91_BASE_URL}/whatsapp/whatsapp-outbound-message/bulk/`,
                payload,
                { headers, timeout: 30_000 }
            );
            return retryResponse.data;
        }

        const status = error.response?.status;
        const errData = error.response?.data;

        const message =
            errData?.message ||
            errData?.error ||
            error.message ||
            "API call failed";

        logger.error(`[MSG91] Error HTTP ${status ?? "N/A"}: ` + JSON.stringify(errData ?? error.message));
        throw new Error(`MSG91 [${status ?? "N/A"}]: ${message}`);
    }
};