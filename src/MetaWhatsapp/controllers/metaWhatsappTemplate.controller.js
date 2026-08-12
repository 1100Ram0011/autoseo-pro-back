import mongoose from "mongoose";
import FormData from "form-data";
import multer from "multer";

import Template from "../models/metaWhatsappCampaignTemplateSchema.js";
import WhatsAppNumber from "../models/metaWhatsappCampaignTokenSchema.js";

import {
    submitTemplateToMeta,
    fetchTemplateFromMeta,
    deleteTemplateFromMeta
} from "../services/metaWhatsapp.services.js";
import MetaGraphClient from "../services/metaFbWhatsapp.client.js";
import socketService from "../../socket.js";
import { syncWithMetaGraph } from "../utils/metaSync.util.js";
import config from "../../config/config.js";

/* =====================================================
   MULTER — in-memory storage for media uploads
   Meta accepts: PNG, JPEG, WEBP images; MP4 video; PDF docs.
   Max file size: 16 MB (Meta's limit for resumable uploads).
===================================================== */

const storage = multer.memoryStorage();

export const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 },   // 16 MB max (Meta limit)
    fileFilter: (_req, file, cb) => {
        const allowed = [
            "image/png", "image/jpeg", "image/webp",
            "video/mp4",
            "application/pdf"
        ];
        if (allowed.includes(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error(`Unsupported media type: ${file.mimetype}`));
    }
});

/* =====================================================
   STANDARD ERROR HANDLER
   Handles three error formats:
   1. MetaGraphClient errors (have metaCode, metaType, metaFbTraceId)
   2. Mongoose ValidationErrors
   3. Generic JS errors
===================================================== */

const getFriendlyMetaMessage = (rawMessage) => {
    if (!rawMessage || typeof rawMessage !== "string") return null;
    const lower = rawMessage.toLowerCase();
    
    if (lower.includes("component of type body is missing expected field(s) (example)") ||
        (lower.includes("component of type body") && lower.includes("missing") && lower.includes("example"))) {
        return "The template body has variables (like {{1}}), but no sample values were provided. Please add sample values for all variables in the body before submitting.";
    }
    
    if (lower.includes("component of type header is missing expected field(s) (example)") ||
        (lower.includes("component of type header") && lower.includes("missing") && lower.includes("example"))) {
        return "The template header requires a sample value or media file, but none was provided. Please add sample data/upload a file for the header.";
    }
    
    if (lower.includes("component of type buttons is missing expected field(s) (example)") ||
        (lower.includes("component of type buttons") && lower.includes("missing") && lower.includes("example"))) {
        return "A button in this template has a dynamic variable, but no sample value was provided. Please add sample values for the button variables.";
    }

    if (lower.includes("name is required")) {
        return "Template name is required.";
    }
    
    if (lower.includes("category is required")) {
        return "Please select a category for the template.";
    }
    
    if (lower.includes("components is required")) {
        return "The template components (such as Body text) are required.";
    }
    
    return null;
};

const handleError = (res, error, fallback = "Server error") => {
    // Check if we can derive a friendly message
    const friendlyMessage = getFriendlyMetaMessage(error.message || error.response?.data?.error?.message || error.response?.data?.message);

    // MetaGraphClient standardized error — contains Meta-specific debug info
    if (error.metaCode || error.metaType) {
        return res.status(error.statusCode || 500).json({
            success: false,
            data: null,
            message: friendlyMessage || error.message || fallback,
            metaCode: error.metaCode || null,
            metaType: error.metaType || null,
            metaFbTraceId: error.metaFbTraceId || null
        });
    }

    // Legacy axios-style errors (from any remaining direct HTTP calls)
    if (error.response) {
        return res.status(error.response.status || 500).json({
            success: false,
            data: null,
            message:
                friendlyMessage ||
                error.response.data?.error?.message ||
                error.response.data?.message ||
                fallback,
            providerError: error.response.data || null
        });
    }

    // Mongoose validation errors — return field-level details
    if (error.name === "ValidationError") {
        return res.status(400).json({
            success: false,
            data: null,
            message: "Validation failed",
            errors: error.errors
        });
    }

    // Generic fallback
    return res.status(500).json({
        success: false,
        data: null,
        message: friendlyMessage || error.message || fallback
    });
};

/* =====================================================
   META STATUS MAP
   Maps Meta's status strings to our local schema enum.
   IN_APPEAL and LIMIT_EXCEEDED are Meta-specific states
   that we now track for production-grade visibility.
===================================================== */

const META_STATUS_MAP = {
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    PENDING: "PENDING",
    PAUSED: "PAUSED",
    DISABLED: "DISABLED",
    IN_APPEAL: "IN_APPEAL",
    LIMIT_EXCEEDED: "LIMIT_EXCEEDED"
};

/* =====================================================
   HELPER — resolve WhatsApp number doc
   Accepts a MongoDB _id and returns the full document
   including sensitive fields needed for API calls.
===================================================== */

const resolveWaNumber = async (numberId, userId) => {
    const res = await WhatsAppNumber.findOne({
        _id: numberId,
        userId,
    }).select("+accessToken +appSecret +webhookVerifyToken").lean();

    return res;
};

/* =====================================================
   HELPER — Parse Meta components array into our schema
   Meta returns templates as a flat components[] array.
   We decompose it into header, body, footer, buttons
   to match our structured Mongoose schema.
===================================================== */

const parseMetaComponents = (components = []) => {
    let header = { format: "NONE" };
    let body = "";
    let footer = undefined;
    let buttons = [];
    let bodySamples = undefined;
    let carouselCards = undefined;
    let marketingType = undefined;
    let offerMessage = undefined;

    components.forEach(comp => {
        switch (comp.type) {
            case "HEADER":
                // Parse header component — extract format, text, and example data
                header = {
                    format: comp.format || "NONE",
                    text: comp.text || undefined
                };
                // Store example data if present (header_text for TEXT, header_handle for MEDIA)
                if (comp.example) {
                    header.example = {};
                    if (comp.example.header_text) {
                        header.example.header_text = comp.example.header_text;
                    }
                    if (comp.example.header_handle) {
                        header.example.header_handle = comp.example.header_handle;
                    }
                }
                break;

            case "BODY":
                // Parse body text and extract variable example values
                body = comp.text || "";
                if (comp.example?.body_text) {
                    bodySamples = comp.example.body_text;
                }
                break;

            case "FOOTER":
                footer = comp.text || "";
                break;

            case "BUTTONS":
                // Map each Meta button to our schema format
                buttons = (comp.buttons || []).map(b => {
                    const btn = { type: b.type };
                    if (b.text) btn.text = b.text;

                    // Type-specific field mapping
                    if (b.type === "URL") {
                        btn.url = b.url;
                        if (b.example) btn.example = b.example;
                    }
                    if (b.type === "PHONE_NUMBER") {
                        btn.phoneNumber = b.phone_number;
                    }
                    if (b.type === "OTP") {
                        btn.otpType = b.otp_type;
                    }
                    if (b.type === "FLOW") {
                        btn.flowId = b.flow_id;
                        btn.flowName = b.flow_name;
                        btn.flowAction = b.flow_action;
                    }
                    if (b.type === "COPY_CODE" && b.example) {
                        btn.example = Array.isArray(b.example) ? b.example : [b.example];
                    }

                    return btn;
                });
                break;

            case "LIMITED_TIME_OFFER":
                marketingType = "LIMITED_TIME_OFFER";
                if (comp.limited_time_offer?.text) {
                    offerMessage = comp.limited_time_offer.text;
                }
                break;

            case "CAROUSEL":
                marketingType = "CAROUSEL";
                carouselCards = [];
                if (comp.cards && Array.isArray(comp.cards)) {
                    comp.cards.forEach((card, index) => {
                        let parsedCard = { id: index + 1 };
                        (card.components || []).forEach(cComp => {
                            if (cComp.type === "HEADER") {
                                if (cComp.format) {
                                    header.format = cComp.format;
                                }
                                if (cComp.example?.header_handle) {
                                    parsedCard.headerHandle = Array.isArray(cComp.example.header_handle) 
                                        ? cComp.example.header_handle[0] 
                                        : cComp.example.header_handle;
                                }
                            } else if (cComp.type === "BODY") {
                                parsedCard.body = cComp.text || "";
                            } else if (cComp.type === "BUTTONS") {
                                parsedCard.buttons = (cComp.buttons || []).map(b => {
                                    const btn = { type: b.type };
                                    if (b.text) btn.text = b.text;
                                    if (b.type === "URL") {
                                        btn.url = b.url;
                                        if (b.example) btn.example = b.example;
                                    }
                                    if (b.type === "PHONE_NUMBER") {
                                        btn.phoneNumber = b.phone_number;
                                    }
                                    return btn;
                                });
                            }
                        });
                        carouselCards.push(parsedCard);
                    });
                }
                break;
        }
    });

    return { header, body, footer, buttons, bodySamples, carouselCards, marketingType, offerMessage };
};

/* =====================================================
   UPLOAD SAMPLE MEDIA
   POST /api/meta-whatsapp/upload-media
   multipart/form-data: { numberId, media (file) }
   Returns: { success, header_handle }

   Meta requires a resumable upload session for media.
   Step 1 — Start upload session  (POST /{app-id}/uploads)
   Step 2 — Upload binary data    (POST /{upload-session-id})
   The returned `h` handle must be stored in
   template.header.headerHandle before submitting.

   Reference: Meta Graph API — Resumable Upload
===================================================== */

export const metaUploadMedia = async (req, res) => {
    try {
        const { numberId } = req.body;

        if (!numberId) {
            return res.status(400).json({
                success: false,
                message: "numberId is required"
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Media file is required"
            });
        }

        const waNumber = await resolveWaNumber(numberId, req.user?.id);

        if (!waNumber) {
            return res.status(404).json({
                success: false,
                message: "WhatsApp number not found"
            });
        }

        if (!["active","connected"].includes(waNumber?.status)) {
            return res.status(400).json({
                success: false,
                message: `WhatsApp number is ${waNumber.status} and cannot be used`
            });
        }

        const { accessToken, appId } = waNumber;
        const finalAppId = appId || config.META_WHATSAPP_APP_ID;

        if (!finalAppId) {
            return res.status(400).json({
                success: false,
                message: "App ID is missing in configuration or WhatsApp number."
            });
        }

        /* ── Step 1: Start a resumable upload session ── */
        // This tells Meta we're about to upload a file and gets a session ID
        const sessionRes = await MetaGraphClient.createUploadSession(
            finalAppId, 
            accessToken, 
            req.file.size, 
            req.file.mimetype,
            req.file.originalname
        );

        const uploadSessionId = sessionRes?.id;

        if (!uploadSessionId) {
            return res.status(502).json({
                success: false,
                message: "Failed to start Meta upload session",
                providerError: sessionRes
            });
        }

        /* ── Step 2: Upload the binary file ── */
        // Sends the actual file bytes to Meta's upload endpoint
        const uploadRes = await MetaGraphClient.uploadMediaToSession(
            uploadSessionId,
            accessToken,
            req.file.buffer,
            req.file.mimetype
        );

        const headerHandle = uploadRes?.h;

        if (!headerHandle) {
            return res.status(502).json({
                success: false,
                message: "Meta media upload failed — no handle returned",
                providerError: uploadRes
            });
        }

        // Return the handle — caller should store it in template.header.headerHandle
        return res.status(200).json({
            success: true,
            message: "Media uploaded successfully",
            header_handle: headerHandle,
            data: uploadRes || null
        });

    } catch (error) {
        console.error("❌ Meta Media Upload Error:", error.message);
        return handleError(res, error, "Failed to upload media");
    }
};

/* =====================================================
   GET + SYNC TEMPLATES
   GET /api/meta-whatsapp?numberId=xxx
   
   Flow:
   1. Fetch ALL templates from Meta Graph API for this WABA
   2. Parse Meta's components[] into our schema structure
   3. Upsert each template into our DB (insert new, update existing)
   4. Mark local templates not found in Meta as stale
   5. Query local DB with optional filters and return results
===================================================== */

export const metaGetTemplates = async (req, res) => {
    try {
        const {
            numberId,
            template_status,
            template_language,
            category
        } = req.query;

        console.log(req.query);

        if (!numberId) {
            return res.status(400).json({
                success: false,
                message: "numberId is required"
            });
        }

        const waNumber = await resolveWaNumber(numberId, req.user?.id);

        if (!waNumber) {
            return res.status(404).json({
                success: false,
                message: "WhatsApp number not found"
            });
        }

        /* ── Step 1: Fetch all templates from Meta for this WABA ── */
        const metaTemplates = await fetchTemplateFromMeta({
            wabaId: waNumber.wabaId,
            accessToken: waNumber.accessToken
        });

        /* ── Step 2-3: Parse components & upsert each Meta template into our DB ── */
        const bulkOps = [];
        const metaIds = [];

        (metaTemplates || []).forEach(tmpl => {
            metaIds.push(tmpl.id);

            // Decompose Meta's flat components[] into our structured schema fields
            const { header, body, footer, buttons, bodySamples, carouselCards, marketingType, offerMessage } = parseMetaComponents(tmpl.components);

            // Auto-detect variable count from body text
            const matches = body.match(/{{\d+}}/g);
            const variablesCount = matches ? new Set(matches).size : 0;

            bulkOps.push({
                updateOne: {
                    filter: {
                        metaTemplateId: tmpl.id,
                        numberId: waNumber._id
                    },
                    update: {
                        $set: {
                            // Identity
                            name: tmpl.name,
                            category: tmpl.category,
                            language: tmpl.language,

                            // Status from Meta
                            status: META_STATUS_MAP[tmpl.status] || tmpl.status,
                            rejectionReason: tmpl.rejected_reason || null,

                            // Quality score — Meta returns { score, date }
                            qualityScore: tmpl.quality_score?.score || "UNKNOWN",
                            qualityScoreDate: tmpl.quality_score?.date
                                ? new Date(tmpl.quality_score.date * 1000)
                                : null,

                            // Parsed content from components[]
                            header,
                            body,
                            footer,
                            buttons,
                            bodySamples: bodySamples || undefined,
                            carouselCards: carouselCards || undefined,
                            marketingType: marketingType || undefined,
                            offerMessage: offerMessage || undefined,
                            variablesCount,

                            // Sync metadata
                            notFoundInMeta: false,
                            updatedAt: new Date()
                        },
                        $setOnInsert: {
                            userId: req.user?.id,
                            isDeleted: false,
                            isLocked: tmpl.status === "APPROVED"
                        }
                    },
                    upsert: true
                }
            });
        });

        if (bulkOps.length) {
            await Template.bulkWrite(bulkOps, { ordered: false });
        }

        /* ── Step 4: Mark local templates no longer found in Meta ── */
        // Templates that exist locally but not in Meta's response are stale
        // (e.g., deleted from Meta Business Manager directly)
        if (metaIds.length) {
            await Template.updateMany(
                {
                    numberId: waNumber._id,
                    metaTemplateId: { $nin: metaIds },
                    status: { $ne: "DRAFT" }
                },
                { $set: { notFoundInMeta: true } }
            );
        }

        /* ── Step 5: Query local DB with optional filters ── */
        const filter = {
            numberId: waNumber._id,
            isDeleted: { $ne: true },
            notFoundInMeta: { $ne: true }
        };

        if (template_status) filter.status = template_status;
        if (template_language) filter.language = template_language;
        if (category) filter.category = category;

        const templates = await Template.find(filter)
            .populate("numberId", "displayName phoneNumber wabaId status")
            .lean()
            .sort({ createdAt: -1 });

        return res.json({ success: true, data: templates, metaTemplates });

    } catch (error) {
        return handleError(res, error, "Failed to fetch/sync templates");
    }
};

/* =====================================================
   CREATE TEMPLATE (DRAFT)
   POST /api/meta-whatsapp
   Body: { name, category, language, numberId, header,
           body, footer, buttons, ttl, authConfig,
           bodySamples, messageSendTtlSeconds, allowCategoryChange }

   Creates a DRAFT template in our local DB.
   Does NOT submit to Meta yet — call POST /:id/submit for that.
   This two-step flow allows users to preview/edit before submission.
===================================================== */

export const metaCreateTemplate = async (req, res) => {
    try {
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Request body is required"
            });
        }

        // Strip server-side-only fields that the client should never set
        const {
            status, isLocked, isDeleted, notFoundInMeta,
            metaTemplateId, version, qualityScore, qualityScoreDate,
            ...safeBody
        } = req.body;

        const { numberId } = safeBody;

        if (!numberId) {
            return res.status(400).json({
                success: false,
                message: "numberId is required"
            });
        }

        // Verify the user owns this WhatsApp number & select credentials
        const waNumber = await resolveWaNumber(numberId, req.user?.id);

        if (!waNumber) {
            return res.status(404).json({
                success: false,
                message: "WhatsApp number not found"
            });
        }

        if (!waNumber.wabaId || !waNumber.accessToken) {
            return res.status(400).json({
                success: false,
                message: "WhatsApp number is missing wabaId or accessToken"
            });
        }

        // ── STEP 1: VALIDATE MONGOOSE SCHEMA LOCALLY ──
        const docInstance = new Template({
            ...safeBody,
            userId: req.user?.id,
            status: "DRAFT",
            version: 1,
            isLocked: false,
            isDeleted: false,
            notFoundInMeta: false,
            metaTemplateId: null
        });

        const validationError = docInstance.validateSync();
        if (validationError) {
            return res.status(400).json({
                success: false,
                message: "Schema validation failed: " + validationError.message,
                errors: validationError.errors
            });
        }

        // ── STEP 2: CALL META GRAPH API FOR SUBMISSION ──
        const metaPayload = docInstance.toMetaPayload();

        const metaResponse = await submitTemplateToMeta({
            wabaId: waNumber.wabaId,
            payload: metaPayload,
            accessToken: waNumber.accessToken
        });

        if (!metaResponse?.id) {
            return res.status(502).json({
                success: false,
                message: "Meta submission failed — no template ID returned",
                providerError: metaResponse
            });
        }

        // ── STEP 3: PERSIST TEMPLATE INTO MONGOOSE DATABASE ──
        docInstance.metaTemplateId = metaResponse.id;
        docInstance.status = metaResponse.status || "PENDING";
        docInstance.isLocked = true;

        const savedTemplate = await docInstance.save();

        return res.status(201).json({
            success: true,
            message: "Template created and submitted to Meta successfully",
            data: savedTemplate,
            metaResponse
        });

    } catch (error) {
        return handleError(res, error, "Failed to create template");
    }
};

/* =====================================================
   UPDATE DRAFT TEMPLATE
   PATCH /api/meta-whatsapp/:id
   Only allowed for DRAFT or REJECTED templates.
   Locked / approved templates must be cloned instead
   (Meta does not allow in-place edits of approved templates).
===================================================== */

export const metaUpdateTemplate = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid template ID" });
        }

        const template = await Template.findOne({
            _id: id,
            userId: req.user?.id,
            isDeleted: false
        });

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        // Meta API allows editing of existing templates (even APPROVED ones).
        // However, we must ensure name and language are not changed if it's already on Meta.
        if (template.metaTemplateId) {
            if (req.body.name && req.body.name !== template.name) {
                return res.status(400).json({ success: false, message: "Cannot change the name of a template that has already been submitted to Meta." });
            }
            if (req.body.language && req.body.language !== template.language) {
                return res.status(400).json({ success: false, message: "Cannot change the language of a template that has already been submitted to Meta." });
            }
        }

        // Whitelist of editable fields — never allow status/lock fields from client
        const ALLOWED = [
            "name", "category", "language", "numberId",
            "ttl", "header", "body", "footer", "buttons",
            "authConfig", "bodySamples", "rejectionReason",
            "messageSendTtlSeconds", "allowCategoryChange",
            "utilityType", "variableType", "marketingType", "offerMessage"
        ];

        ALLOWED.forEach(key => {
            if (req.body[key] !== undefined) {
                template[key] = req.body[key];
            }
        });

        await template.save();  // triggers pre-save hooks (variable detection, name format, etc.)

        return res.json({ success: true, data: template });

    } catch (error) {
        return handleError(res, error, "Failed to update template");
    }
};

/* =====================================================
   SUBMIT TEMPLATE TO META
   POST /api/meta-whatsapp/:id/submit

   Flow:
   1. Load the saved DRAFT template
   2. Build the Meta-compatible payload via toMetaPayload()
   3. Submit to Meta via POST /{waba_id}/message_templates
   4. Store the returned metaTemplateId and lock the template

   After submission, the template enters Meta's review pipeline.
   Status will transition: SUBMITTED → PENDING → APPROVED/REJECTED
===================================================== */

export const metaSubmitTemplate = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid template ID" });
        }

        const template = await Template.findOne({
            _id: id,
            userId: req.user?.id,
            isDeleted: false
        }).populate("numberId", "wabaId accessToken status displayName phoneNumberId qualityRating messagingLimit");

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        // We allow submitting templates in any state. If it already exists on Meta (has metaTemplateId),
        // Meta will treat it as an update if the name and language match.
        // Wait, Meta docs say you can edit APPROVED, REJECTED, PENDING, PAUSED templates.
        if (template.status === "DISABLED" || template.status === "DELETED") {
            return res.status(400).json({
                success: false,
                message: `Cannot submit template in "${template.status}" state.`
            });
        }

        const waNumber = template.numberId;

        if (!waNumber) {
            return res.status(400).json({
                success: false,
                message: "WhatsApp number not found on this template"
            });
        }

        // ── Just-In-Time Number Status Sync ────────────────────────────────────────
        try {
            await syncWithMetaGraph({
                document: waNumber,
                phoneNumberId: waNumber.phoneNumberId,
                accessToken: waNumber.accessToken,
                fetchFromMetaFn: () => MetaGraphClient.getPhoneNumberDetails(waNumber.phoneNumberId, waNumber.accessToken),
                extractLiveStateFn: (res) => res,
                compareAndUpdateFn: (doc, liveData) => {
                    let needsSave = false;
                    if (liveData.quality_rating && doc.qualityRating !== liveData.quality_rating.toUpperCase()) {
                        doc.qualityRating = liveData.quality_rating.toUpperCase();
                        needsSave = true;
                    }
                    if (liveData.messaging_limit_tier && doc.messagingLimit !== liveData.messaging_limit_tier) {
                        doc.messagingLimit = liveData.messaging_limit_tier;
                        needsSave = true;
                    }
                    if (liveData.status && doc.status !== liveData.status) {
                        doc.status = liveData.status;
                        needsSave = true;
                    }
                    return needsSave;
                }
            });
            logger.info(`[Template] JIT sync completed for ${waNumber.phoneNumberId} before submitting template ${id}`);
        } catch (syncErr) {
            logger.warn(`[Template] Failed to run JIT status sync for ${id}: ${syncErr.message}`);
        }

        // Guard: minimum required fields for Meta submission
        if (!template.name || (template.category !== "AUTHENTICATION" && !template.body)) {
            return res.status(400).json({
                success: false,
                message: "Template is missing name or body — cannot submit"
            });
        }

        // Guard: if template has variables, bodySamples MUST be provided
        if (template.variablesCount > 0 && (!template.bodySamples || !template.bodySamples.length)) {
            return res.status(400).json({
                success: false,
                message: `Template has ${template.variablesCount} variable(s) but no sample data. Provide bodySamples before submitting.`
            });
        }

        // Guard: Text header with variables needs example
        if (template.header?.format === "TEXT" && template.header?.text?.includes("{{1}}")) {
            if (!template.header?.example?.header_text || !template.header.example.header_text.length) {
                return res.status(400).json({
                    success: false,
                    message: "Text header contains a variable but no sample data is provided."
                });
            }
        }

        // Guard: Media header needs an uploaded handle (Carousel templates have handles on the cards instead)
        if (["IMAGE", "VIDEO", "DOCUMENT"].includes(template.header?.format) && template.marketingType !== "CAROUSEL") {
            if (!template.header?.headerHandle && (!template.header?.example?.header_handle || !template.header.example.header_handle.length)) {
                return res.status(400).json({
                    success: false,
                    message: `Template has a ${template.header.format} header but no media was uploaded.`
                });
            }
        }

        // Build the Meta payload from our schema structure
        const metaPayload = template.toMetaPayload();

        // Submit to Meta's Graph API
        const metaResponse = await submitTemplateToMeta({
            wabaId: waNumber.wabaId,
            payload: metaPayload,
            accessToken: waNumber.accessToken
        });

        if (!metaResponse?.id) {
            return res.status(502).json({
                success: false,
                message: "Meta submission failed — no template ID returned",
                providerError: metaResponse
            });
        }

        // Mark as submitted and lock — content cannot be changed after submission
        template.metaTemplateId = metaResponse.id;
        template.status = META_STATUS_MAP[metaResponse.status] || "SUBMITTED";
        template.submissionError = null;
        template.rejectionReason = null;
        template.isLocked = true;

        await template.save();

        return res.json({ success: true, data: template });

    } catch (error) {
        return handleError(res, error, "Failed to submit template");
    }
};

/* =====================================================
   CLONE TEMPLATE
   POST /api/meta-whatsapp/:id/clone

   Creates a new editable DRAFT from any template.
   Resets: metaTemplateId, status→DRAFT, isLocked→false,
           version incremented, media handle cleared
           (media must be re-uploaded for new submission).
===================================================== */

export const metaCloneTemplate = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid template ID" });
        }

        const source = await Template.findOne({
            _id: id,
            userId: req.user?.id,
            isDeleted: false
        });

        if (!source) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        const sourceObj = source.toObject();

        // Clear the media handle — the clone needs a fresh upload before submit
        // Meta upload handles are one-time-use and cannot be reused across templates
        const clonedHeader = { ...(sourceObj.header || {}) };
        if (
            clonedHeader.format &&
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(clonedHeader.format)
        ) {
            clonedHeader.headerHandle = undefined;
            clonedHeader.example = undefined;
        }

        const clone = await Template.create({
            ...sourceObj,
            _id: undefined,
            metaTemplateId: null,
            status: "DRAFT",
            isLocked: false,
            isDeleted: false,
            notFoundInMeta: false,
            submissionError: null,
            rejectionReason: null,
            qualityScore: "UNKNOWN",
            qualityScoreDate: null,
            version: (sourceObj.version || 1) + 1,
            header: clonedHeader,
            createdAt: undefined,
            updatedAt: undefined
        });

        return res.status(201).json({ success: true, data: clone });

    } catch (error) {
        return handleError(res, error, "Failed to clone template");
    }
};

/* =====================================================
   SYNC TEMPLATE STATUS FROM META
   POST /api/meta-whatsapp/:id/sync

   Fetches latest status for ALL user templates from Meta
   and updates local records. Useful for catching
   status changes (PENDING→APPROVED, quality score updates).
===================================================== */
export const metaSyncTemplate = async (req, res) => {
    try {

        const templates = await Template.find({
            userId: req.user?.id,
        }).populate("numberId", "wabaId accessToken");

        if (!templates.length) {
            return res.status(404).json({
                success: false,
                message: "No templates found"
            });
        }

        const results = [];
        const templatesByNumber = new Map();

        for (const template of templates) {
            // Skip templates that were never submitted to Meta
            if (!template.metaTemplateId) {
                results.push({
                    id: template._id,
                    status: "NOT_SUBMITTED"
                });
                continue;
            }

            const waNumber = template.numberId;
            if (!waNumber || !waNumber.wabaId) {
                results.push({
                    id: template._id,
                    status: "NOT_FOUND_NUMBER"
                });
                continue;
            }

            // Group by wabaId
            const wabaId = waNumber.wabaId;
            if (!templatesByNumber.has(wabaId)) {
                templatesByNumber.set(wabaId, {
                    number: waNumber,
                    templates: []
                });
            }
            templatesByNumber.get(wabaId).templates.push(template);
        }

        // Process each WABA once
        for (const [wabaId, { number, templates: wabaTemplates }] of templatesByNumber.entries()) {
            try {
                // Fetch all templates from Meta for this WABA ONCE
                const metaTemplates = await fetchTemplateFromMeta({
                    wabaId: wabaId,
                    accessToken: number.accessToken
                });

                // Update all local templates for this WABA
                for (const template of wabaTemplates) {
                    const metaTemplate = (metaTemplates || []).find(
                        t => t.id === template.metaTemplateId
                    );

                    if (!metaTemplate) {
                        // Template no longer exists in Meta — mark as stale
                        template.notFoundInMeta = true;
                        await template.save();

                        results.push({
                            id: template._id,
                            status: "NOT_FOUND"
                        });
                        continue;
                    }

                    // Update local record with latest Meta data
                    const prevStatus = template.status;

                    template.status = META_STATUS_MAP[metaTemplate.status] || template.status;
                    template.rejectionReason = metaTemplate.rejected_reason || null;
                    template.notFoundInMeta = false;

                    // Update quality score if Meta provides it
                    if (metaTemplate.quality_score) {
                        template.qualityScore = metaTemplate.quality_score.score || "UNKNOWN";
                        if (metaTemplate.quality_score.date) {
                            template.qualityScoreDate = new Date(metaTemplate.quality_score.date * 1000);
                        }
                    }

                    // Lock approved templates to prevent accidental edits
                    if (template.status === "APPROVED" || prevStatus !== "APPROVED") {
                        template.isLocked = true;
                    }

                    await template.save();

                    results.push({
                        id: template._id,
                        status: template.status
                    });
                }
            } catch (err) {
                console.error(`Failed to sync templates for WABA ${wabaId}`, err);
                wabaTemplates.forEach(t => {
                    results.push({ id: t._id, status: "SYNC_FAILED" });
                });
            }
        }

        return res.json({
            success: true,
            message: "Templates synced successfully",
            data: results
        });

    } catch (error) {
        console.log(error, "error");
        return handleError(res, error, "Failed to sync templates");
    }
};

/* =====================================================
   GET META WABA ACTIVATION / CONNECTED NUMBERS
   GET /api/meta-whatsapp/activation
   Returns the WhatsApp numbers connected to this account.
===================================================== */

export const getMetaActivation = async (req, res) => {
    try {
        const numbers = await WhatsAppNumber.find({
            userId: req.user?.id,
            isDeleted: false
        })
            .select("displayName phoneNumber wabaId status createdAt")
            .lean()
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            message: "WhatsApp activation fetched successfully",
            data: numbers
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch WhatsApp activation",
            providerError: error.message
        });
    }
};

/* =====================================================
   DELETE TEMPLATE
   DELETE /api/meta-whatsapp/:id

   Flow:
   1. If submitted to Meta, attempt to delete from Meta first
   2. Soft-delete locally regardless of Meta result
   3. Return success with optional warning if Meta delete failed
===================================================== */

export const metaDeleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid template ID" });
        }

        const template = await Template.findOne({
            _id: id,
            userId: req.user?.id,
            isDeleted: false
        }).populate("numberId", "wabaId accessToken");

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        let metaDeleteError = null;

        // Attempt Meta deletion only if it was ever submitted
        if (template.metaTemplateId && template.status !== "DRAFT") {
            try {
                const waNumber = template.numberId;
                await deleteTemplateFromMeta({
                    wabaId: waNumber.wabaId,
                    templateName: template.name,
                    accessToken: waNumber.accessToken
                });
            } catch (err) {
                // Log but don't block local soft-delete
                // The template may already have been deleted from Meta Business Manager
                metaDeleteError = err.message;
                console.error(
                    `❌ Meta delete failed for template ${template._id}:`,
                    err.message
                );
            }
        }

        // Soft-delete locally — keeps the record for audit trail
        template.isDeleted = true;
        template.isLocked = false;
        await template.save();

        const response = {
            success: true,
            message: "Template deleted successfully"
        };

        if (metaDeleteError) {
            response.warning = `Deleted locally but Meta deletion failed: ${metaDeleteError}`;
        }

        return res.json(response);

    } catch (error) {
        console.error("❌ Delete Template Error:", error.message);
        return handleError(res, error, "Failed to delete template");
    }
};