import axios from "axios";
import mongoose from "mongoose";
import FormData from "form-data";
import multer from "multer";
import Template from "../../../../models/Campaign/WhatsappCampaign/Msg91/WhatsappTemplateSchema.js";
import { buildMsg91Payload } from "../../../../utils/buildMsg91Payload.js";
import config from "../../../../config/config.js";
import Msg91WhatsappActivationNumberSchema from "../../../../models/Campaign/WhatsappCampaign/Msg91/Msg91WhatsappActivationNumberSchema.js";

/* =====================================================
   MULTER — in-memory storage for media uploads
===================================================== */

const storage = multer.memoryStorage();

const getUserId = (req) => req.user?._id || req.user?.id || null;

export const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB max (MSG91 limit)
    fileFilter: (_req, file, cb) => {
        const allowed = [
            "image/png",
            "image/jpeg",
            "image/webp",
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
   SHARED AXIOS INSTANCE
===================================================== */

const msg91Client = axios.create({
    baseURL: "https://control.msg91.com/api/v5",
    timeout: 30000,
    headers: {
        accept: "application/json",
        authkey: config.MSG91_AUTHKEY
    }
});

/* =====================================================
   STANDARD ERROR HANDLER
===================================================== */

const handleError = (res, error, fallback = "Server error") => {
    if (error.response) {
        return res.status(error.response.status || 500).json({
            success: false,
            data: null,
            message:
                error.response.data?.message ||
                error.response.data?.errors ||
                fallback,
            providerError: error.response.data || null
        });
    }

    if (error.name === "ValidationError") {
        return res.status(400).json({
            success: false,
            data: null,
            message: "Validation failed",
            errors: error.errors
        });
    }

    return res.status(500).json({
        success: false,
        data: null,
        message: error.message || fallback
    });
};

/* =====================================================
   PARSE MSG91 CODE COMPONENTS
   Extracts header, body, footer, buttons from the
   `code` array returned per language by MSG91.

   MSG91 component types: HEADER | BODY | FOOTER | BUTTONS

   Returns a structured object ready to be merged into
   the Template document.
===================================================== */

const parseMsg91Components = (codeArray = []) => {
    const result = {
        header: { type: "NONE", text: undefined, mediaUrl: undefined },
        body: "",
        footer: null,
        buttons: []
    };

    if (!Array.isArray(codeArray) || codeArray.length === 0) {
        return result;
    }

    for (const component of codeArray) {
        const compType = (component?.type || "").toUpperCase();

        switch (compType) {
            case "HEADER": {
                const format = (component?.format || "NONE").toUpperCase();

                if (format === "TEXT") {
                    result.header = {
                        type: "TEXT",
                        text: component?.text || "",
                        mediaUrl: undefined
                    };
                } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
                    // Media handle / URL may be nested inside example.header_handle
                    const mediaUrl =
                        component?.example?.header_handle?.[0] ||
                        component?.example?.header_url?.[0] ||
                        null;

                    result.header = {
                        type: format,
                        text: undefined,
                        mediaUrl
                    };
                } else {
                    result.header = { type: "NONE" };
                }
                break;
            }

            case "BODY": {
                result.body = component?.text || "";
                break;
            }

            case "FOOTER": {
                result.footer = component?.text || null;
                break;
            }

            case "BUTTONS": {
                const rawButtons = Array.isArray(component?.buttons)
                    ? component.buttons
                    : [];

                result.buttons = rawButtons
                    .map((btn) => {
                        const btnType = (btn?.type || "").toUpperCase();

                        // Map MSG91 button types to our schema enum
                        if (btnType === "QUICK_REPLY") {
                            return { type: "QUICK_REPLY", text: btn.text || "" };
                        }
                        if (btnType === "URL") {
                            return {
                                type: "URL",
                                text: btn.text || "",
                                url: btn.url || ""
                            };
                        }
                        if (btnType === "PHONE_NUMBER") {
                            return {
                                type: "PHONE",
                                text: btn.text || "",
                                phone: btn.phone_number || btn.phone || ""
                            };
                        }
                        // Skip unsupported button types
                        return null;
                    })
                    .filter(Boolean);
                break;
            }

            default:
                break;
        }
    }

    return result;
};

/* =====================================================
   NORMALIZE MSG91 STATUS
   MSG91 returns statuses that may differ in casing or
   naming from our schema enum. Normalise to our values.
===================================================== */

const normalizeStatus = (raw = "") => {
    const VALID = ["DRAFT", "SUBMITTED", "PENDING", "APPROVED", "REJECTED", "DISABLED"];
    const upper = (raw || "").toUpperCase();
    return VALID.includes(upper) ? upper : "PENDING";
};

/* =====================================================
   UPLOAD SAMPLE MEDIA
   POST /api/whatsapp/upload-media
   multipart/form-data: { whatsapp_number, media (file) }
   Returns: { success, header_handle }

   The returned header_handle must be stored in
   template.header.mediaUrl before submitting.
===================================================== */

export const whatsappUploadMedia = async (req, res) => {
    try {
        const { whatsapp_number } = req.body;

        if (!whatsapp_number) {
            return res.status(400).json({
                success: false,
                message: "whatsapp_number is required"
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Media file is required"
            });
        }

        const form = new FormData();
        form.append("whatsapp_number", String(whatsapp_number).trim());
        form.append("media", req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        const response = await axios.post(
            "https://api.msg91.com/api/v5/whatsapp/sample-media-upload/",
            form,
            {
                headers: {
                    authkey: config.MSG91_AUTHKEY,
                    ...form.getHeaders()
                },
                timeout: 30000
            }
        );

        if (response.data?.status !== "success") {
            return res.status(502).json({
                success: false,
                message: "MSG91 media upload failed",
                providerError: response.data
            });
        }

        return res.status(200).json({
            success: true,
            message: "Media uploaded successfully",
            header_handle: response.data?.data?.url || null,
            data: response.data?.data || null
        });
    } catch (error) {
        console.error("❌ Media Upload Error:", error?.response?.data || error.message);
        return handleError(res, error, "Failed to upload media");
    }
};

/* =====================================================
   GET + SYNC TEMPLATES
   GET /api/whatsapp?integrated_number=xxx
              &template_status=APPROVED
              &template_language=en

   Flow:
   1. Fetch all templates from MSG91 for the WABA number
   2. Parse each language variant's code[] into our schema
   3. Bulk-upsert into local DB (preserves DRAFT-only fields)
   4. Mark templates that no longer exist in MSG91
   5. Return filtered list from local DB
===================================================== */

export const whatsappGetTemplates = async (req, res) => {
    try {
        const userId = getUserId(req);

        const { integrated_number, template_status, template_language } = req.query;

        // ── 1. Validate Input ───────────────────────────────────────────────
        if (!integrated_number) {
            return res.status(400).json({
                success: false,
                message: "integrated_number (wabaNumber) is required"
            });
        }

        // ── 2. Fetch Templates from MSG91 ───────────────────────────────────
        const response = await msg91Client.get(
            `/whatsapp/get-template-client/${integrated_number}`
        );

        if (response?.data?.status !== "success") {
            return res.status(502).json({
                success: false,
                message: "Invalid response from MSG91",
                providerError: response.data
            });
        }

        // ── 3. Safe Array Extraction ────────────────────────────────────────
        // MSG91 returns an array of template objects, each with a `languages`
        // array. We iterate both levels.
        const msg91Templates = Array.isArray(response?.data?.data)
            ? response.data.data
            : [];

        const bulkOps = [];
        const msg91Ids = []; // collect all known IDs to mark missing ones later

        // ── 4. Transform + Prepare Bulk Ops ─────────────────────────────────
        for (const tmpl of msg91Templates) {
            // Each top-level object has: category, name, namespace, languages[]
            if (!Array.isArray(tmpl?.languages)) continue;

            const templateName = (tmpl?.name || "").toLowerCase().trim();
            const templateCategory = (tmpl?.category || "").toUpperCase();
            const templateNamespace = tmpl?.namespace || null;

            for (const lang of tmpl.languages) {
                // lang shape: { id, name, language, parameter_format, status,
                //               rejection_reason, variables, variable_type,
                //               is_disabled, code[] }

                if (!lang?.id) continue;

                msg91Ids.push(lang.id);

                // Parse the code[] components into our schema fields
                const components = parseMsg91Components(
                    Array.isArray(lang?.code) ? lang.code : []
                );

                const normalizedStatus = lang?.is_disabled
                    ? "DISABLED"
                    : normalizeStatus(lang?.status);

                const rejectionReason =
                    lang?.rejection_reason &&
                        lang.rejection_reason !== "NONE"
                        ? lang.rejection_reason
                        : null;

                bulkOps.push({
                    updateOne: {
                        filter: {
                            userId,
                            msg91TemplateId: lang.id,
                            wabaNumber: integrated_number
                        },
                        update: {
                            $set: {
                                // Identity
                                userId,
                                wabaNumber: integrated_number,
                                msg91TemplateId: lang.id,

                                // Template metadata
                                name: templateName,
                                category: templateCategory,
                                namespace: templateNamespace,

                                // Language variant metadata
                                language: lang?.language || "en",
                                parameterFormat: lang?.parameter_format || null,
                                status: normalizedStatus,
                                rejectionReason,

                                // Parsed components
                                header: components.header,
                                body: components.body,
                                footer: components.footer,
                                buttons: components.buttons,

                                // Raw components for frontend rendering
                                _msg91Components: Array.isArray(lang?.code)
                                    ? lang.code
                                    : [],

                                // Sync housekeeping
                                notFoundInMsg91: false,
                                updatedAt: new Date()
                            },
                            // Only set these on INSERT (upsert create), never overwrite
                            $setOnInsert: {
                                version: 1,
                                isLocked: false,
                                isDeleted: false,
                                variablesCount: 0,
                                bodySamples: [],
                                ttl: null,
                                authConfig: {
                                    addSecurityRecommendation: false,
                                    codeExpirationMinutes: null
                                }
                            }
                        },
                        upsert: true
                    }
                });
            }
        }

        // ── 5. Execute Bulk Write ───────────────────────────────────────────
        if (bulkOps.length > 0) {
            await Template.bulkWrite(bulkOps, { ordered: false });
        }

        // ── 6. Mark Templates No Longer in MSG91 ───────────────────────────
        // Any non-DRAFT template in our DB that MSG91 no longer returns
        // is flagged so the frontend can show a warning / hide it.
        if (msg91Ids.length > 0) {
            await Template.updateMany(
                {
                    userId,
                    wabaNumber: integrated_number,
                    msg91TemplateId: { $nin: msg91Ids },
                    status: { $ne: "DRAFT" }
                },
                { $set: { notFoundInMsg91: true } }
            );
        }

        // ── 7. Build Local DB Filter ────────────────────────────────────────
        const filter = {
            userId,
            wabaNumber: integrated_number,
            isDeleted: { $ne: true },
            notFoundInMsg91: { $ne: true }
        };

        if (template_status) {
            filter.status = template_status.toUpperCase();
        }

        if (template_language) {
            filter.language = template_language;
        }

        // ── 8. Return Final Templates ───────────────────────────────────────
        const templates = await Template.find(filter)
            .lean()
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            data: templates
        });
    } catch (error) {
        console.error("whatsappGetTemplates Error:", error);
        return res.status(500).json({
            success: false,
            data: null,
            message: error?.message || "Failed to fetch/sync templates"
        });
    }
};

/* =====================================================
   CREATE TEMPLATE (DRAFT)
   POST /api/whatsapp
   Body: { name, category, language, wabaNumber, header,
           body, footer, buttons, ttl, authConfig }
   Returns the saved DRAFT document.
===================================================== */

// export const whatsappCreateTemplate = async (req, res) => {
//     try {
//         const userId = getUserId(req);

//         if (!userId) {
//             return res.status(401).json({
//                 success: false,
//                 message: "User Not Found"
//             });
//         }

//         if (!req.body || Object.keys(req.body).length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Request body is required"
//             });
//         }

//         // Strip server-side-only fields — never trust the client for these
//         const {
//             status,
//             isLocked,
//             isDeleted,
//             notFoundInMsg91,
//             msg91TemplateId,
//             namespace,
//             parameterFormat,
//             _msg91Components,
//             version,
//             ...safeBody
//         } = req.body;

//         const template = await Template.create({
//             ...safeBody,
//             userId,
//             status: "DRAFT",
//             version: 1,
//             isLocked: false,
//             isDeleted: false,
//             notFoundInMsg91: false,
//             namespace: null,
//             parameterFormat: null,
//             _msg91Components: []
//         });

//         return res.status(201).json({ success: true, data: template });
//     } catch (error) {
//         return handleError(res, error, "Failed to create template");
//     }
// };

/* =====================================================
   HELPER: Upload remote URL to MSG91 and get handle
===================================================== */
async function uploadUrlToMsg91(url, wabaNumber) {
    if (!url || !url.startsWith("http")) return url;
    
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = response.data;
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const filename = url.split('/').pop().split('?')[0] || 'media_file';

        const form = new FormData();
        form.append("whatsapp_number", String(wabaNumber).trim());
        form.append("media", buffer, {
            filename: filename,
            contentType: contentType
        });

        const uploadRes = await axios.post(
            "https://api.msg91.com/api/v5/whatsapp/sample-media-upload/",
            form,
            {
                headers: {
                    authkey: config.MSG91_AUTHKEY,
                    ...form.getHeaders()
                },
                timeout: 30000
            }
        );

        if (uploadRes.data?.status === "success" && uploadRes.data?.data?.url) {
            // MSG91 returns the Meta upload handle in the 'url' property
            return uploadRes.data.data.url;
        }
        
        const errorDetails = JSON.stringify(uploadRes.data);
        throw new Error(`MSG91 API Error: ${errorDetails}`);
    } catch (err) {
        console.error("URL to handle upload failed:", err.message, err.response?.data);
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Failed to upload external media URL to MSG91: ${detail}`);
    }
}

export const whatsappCreateTemplate = async (req, res) => {
    try {
        const userId = getUserId(req);

        // =========================
        // 🔐 AUTH CHECK
        // =========================
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User Not Found"
            });
        }

        // =========================
        // 📦 BODY VALIDATION
        // =========================
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Request body is required"
            });
        }

        const {
            status,
            isLocked,
            isDeleted,
            notFoundInMsg91,
            msg91TemplateId,
            namespace,
            parameterFormat,
            _msg91Components,
            version,
            ...safeBody
        } = req.body;

        const wabaNumber = safeBody.wabaNumber || safeBody.integratedNumber;

        // Auto-upload external media URLs to MSG91
        if (safeBody.header?.mediaUrl && safeBody.header.mediaUrl.startsWith("http")) {
            safeBody.header.mediaUrl = await uploadUrlToMsg91(safeBody.header.mediaUrl, wabaNumber);
        }
        if (safeBody.carouselCards && Array.isArray(safeBody.carouselCards)) {
            for (const card of safeBody.carouselCards) {
                if (card.header?.mediaUrl && card.header.mediaUrl.startsWith("http")) {
                    card.header.mediaUrl = await uploadUrlToMsg91(card.header.mediaUrl, wabaNumber);
                }
            }
        }

        // =========================
        // 📝 INSTANTIATE IN-MEMORY DOCUMENT
        // =========================
        const template = new Template({
            ...safeBody,
            authConfig: {
                addSecurityRecommendation: safeBody.addSecurityRecommendation,
                codeExpirationMinutes: safeBody.codeExpirationMinutes
            },
            userId,
            status: "SUBMITTED",
            version: 1,
            isLocked: true,
            isDeleted: false,
            notFoundInMsg91: false,
            namespace: null,
            parameterFormat: null,
            _msg91Components: []
        });

        // =========================
        // 📋 SCHEMA VALIDATION
        // =========================
        try {
            await template.validate();
        } catch (validationError) {
            return handleError(res, validationError, "Validation failed");
        }

        // Guard: body is required for submission
        if (!template.body || template.body.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Template body is required for submission"
            });
        }

        // =========================
        // 🧱 BUILD MSG91 PAYLOAD
        // =========================
        let payload;
        try {
            payload = buildMsg91Payload(template.toObject());
            console.log("FINAL MSG91 PAYLOAD (CREATE):", JSON.stringify(payload, null, 2));
        } catch (payloadError) {
            return res.status(400).json({
                success: false,
                message: payloadError.message || "Failed to build MSG91 payload"
            });
        }

        if (!payload.integrated_number || !payload.template_name) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields (wabaNumber or template name)"
            });
        }

        // =========================
        // 🚀 CALL MSG91 API
        // =========================
        let response;
        try {
            response = await axios.post(
                "https://api.msg91.com/api/v5/whatsapp/client-panel-template/",
                payload,
                {
                    headers: {
                        authkey: config.MSG91_AUTHKEY,
                        "Content-Type": "application/json"
                    }
                }
            );
        } catch (apiError) {
            if (apiError?.response?.data?.hasError) {
                return res.status(400).json({
                    success: false,
                    message: apiError?.response?.data?.errors || apiError?.response?.data?.error || "Failed to submit template",
                    data: apiError?.response?.data?.data || "Failed to submit template"
                });
            } else {
                console.error("API Response error:", apiError.response?.data || apiError.message);
                return res.status(502).json({
                    success: false,
                    message: "Failed to connect to MSG91",
                    error: apiError.message
                });
            }
        }

        // =========================
        // ❌ MSG91 FAILURE
        // =========================
        if (response?.data?.status !== "success") {
            return res.status(502).json({
                success: false,
                message: "MSG91 submission failed",
                providerError: response.data
            });
        }

        // =========================
        // ✅ SUCCESS → SAVE TO DATABASE
        // =========================
        template.msg91TemplateId = response.data?.data?.template_id || null;

        await template.save();

        return res.status(201).json({
            success: true,
            message: "Template created and submitted successfully",
            data: template
        });

    } catch (error) {
        console.error("Template Create/Submit Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to process template",
            error: error.message
        });
    }
};

/* =====================================================
   UPDATE DRAFT TEMPLATE
   PATCH /api/whatsapp/:id
   Only allowed for DRAFT or REJECTED templates.
   Locked/approved templates must be cloned instead.
===================================================== */

export const whatsappUpdateTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User Not Found"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid template ID" });
        }

        const template = await Template.findOne({ _id: id, userId });

        if (!template) {
            return res
                .status(404)
                .json({ success: false, message: "Template not found" });
        }

        if (!["DRAFT", "REJECTED"].includes(template.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot edit a template in "${template.status}" state. Clone it to make changes.`
            });
        }

        // Whitelist of client-editable fields only
        const ALLOWED = [
            "name",
            "category",
            "marketingType",
            "carouselCards",
            "language",
            "wabaNumber",
            "ttl",
            "header",
            "body",
            "footer",
            "buttons",
            "authConfig",
            "bodySamples",
            "rejectionReason"
        ];

        ALLOWED.forEach((key) => {
            if (req.body[key] !== undefined) {
                template[key] = req.body[key];
            }
        });

        if (req.body.category === 'AUTHENTICATION' || template.category === 'AUTHENTICATION') {
            template.authConfig = {
                addSecurityRecommendation: req.body.addSecurityRecommendation ?? template.authConfig?.addSecurityRecommendation,
                codeExpirationMinutes: req.body.codeExpirationMinutes ?? template.authConfig?.codeExpirationMinutes
            };
        }

        const wabaNumber = req.body.wabaNumber || req.body.integratedNumber || template.wabaNumber;

        // Auto-upload external media URLs to MSG91
        if (template.header?.mediaUrl && template.header.mediaUrl.startsWith("http")) {
            template.header.mediaUrl = await uploadUrlToMsg91(template.header.mediaUrl, wabaNumber);
            template.markModified('header');
        }
        if (template.carouselCards && Array.isArray(template.carouselCards)) {
            let modifiedCards = false;
            for (let i = 0; i < template.carouselCards.length; i++) {
                if (template.carouselCards[i].header?.mediaUrl && template.carouselCards[i].header.mediaUrl.startsWith("http")) {
                    template.carouselCards[i].header.mediaUrl = await uploadUrlToMsg91(template.carouselCards[i].header.mediaUrl, wabaNumber);
                    modifiedCards = true;
                }
            }
            if (modifiedCards) template.markModified('carouselCards');
        }

        await template.save(); // triggers pre-save hooks (variablesCount, lock check)

        return res.json({ success: true, data: template });
    } catch (error) {
        return handleError(res, error, "Failed to update template");
    }
};

/* =====================================================
   SUBMIT TEMPLATE TO MSG91
   POST /api/whatsapp/:id/submit
   Reads the saved DRAFT, validates required fields,
   builds the MSG91 payload, submits it, then marks
   the template as SUBMITTED + locked.
===================================================== */

export const whatsappSubmitTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User Not Found"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid template ID" });
        }

        const template = await Template.findOne({ _id: id, userId });

        if (!template) {
            return res
                .status(404)
                .json({ success: false, message: "Template not found" });
        }

        if (!["DRAFT", "REJECTED"].includes(template.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot submit template in "${template.status}" state`
            });
        }

        // Guard: body is required at submit time
        if (!template.body || template.body.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Template body is required before submission"
            });
        }

        // Build MSG91 payload from saved template document
        const payload = buildMsg91Payload(template.toObject());

        if (!payload.integrated_number || !payload.template_name) {
            return res.status(400).json({
                success: false,
                message: "Template is missing wabaNumber or name — cannot submit"
            });
        }

        const response = await axios.post(
            "https://api.msg91.com/api/v5/whatsapp/client-panel-template/",
            payload,
            {
                headers: {
                    authkey: config.MSG91_AUTHKEY,
                    "Content-Type": "application/json"
                },
                timeout: 30000
            }
        );

        if (response.data?.status !== "success") {
            return res.status(502).json({
                success: false,
                message: "MSG91 submission failed",
                providerError: response.data
            });
        }

        // Mark as submitted — pre-save lock hook allows isLocked transition
        template.status = "SUBMITTED";
        template.msg91TemplateId = response.data?.data?.template_id || null;
        template.isLocked = true;

        await template.save();

        return res.json({ success: true, data: template });
    } catch (error) {
        return handleError(res, error, "Failed to submit template");
    }
};

/* =====================================================
   CLONE TEMPLATE
   POST /api/whatsapp/:id/clone
   Creates a new editable DRAFT from any template
   (including locked/approved ones).
   Resets: msg91TemplateId, status→DRAFT, isLocked→false,
           namespace, parameterFormat, _msg91Components,
           version incremented, header.mediaUrl cleared.
===================================================== */

export const whatsappCloneTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User Not Found"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid template ID" });
        }

        const source = await Template.findOne({ _id: id, userId });

        if (!source) {
            return res
                .status(404)
                .json({ success: false, message: "Template not found" });
        }

        const sourceObj = source.toObject();

        // Clear the media handle — the clone needs a fresh upload before submit
        const clonedHeader = { ...sourceObj.header };
        if (
            clonedHeader.type &&
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(clonedHeader.type)
        ) {
            clonedHeader.mediaUrl = undefined;
        }

        const clone = await Template.create({
            ...sourceObj,
            _id: undefined,
            userId,
            header: clonedHeader,
            version: (sourceObj.version || 1) + 1,
            status: "DRAFT",
            isLocked: false,
            isDeleted: false,
            notFoundInMsg91: false,
            // Reset MSG91-managed fields so the clone is treated as a new submission
            msg91TemplateId: null,
            namespace: null,
            parameterFormat: null,
            _msg91Components: [],
            rejectionReason: null,
            createdAt: undefined,
            updatedAt: undefined
        });

        return res.status(201).json({ success: true, data: clone });
    } catch (error) {
        return handleError(res, error, "Failed to clone template");
    }
};

/* =====================================================
   GET WHATSAPP ACTIVATION NUMBERS
   GET /api/whatsapp/activation
===================================================== */

export const getWhatsappActivation = async (req, res) => {
    try {
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const numbers = await Msg91WhatsappActivationNumberSchema.find(
            { userId, isActive: true },
            { integrated_number: 1, createdAt: 1, _id: 1 }
        ).lean();

        return res.status(200).json({
            success: true,
            message: "WhatsApp activation fetched successfully",
            data: numbers
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch WhatsApp activation",
            error: error.message
        });
    }
};

/* =====================================================
   DELETE TEMPLATE
   DELETE /api/whatsapp/delete
   ?integrated_number=&template_name=&template_id=
   Deletes from MSG91 then soft-deletes locally.
===================================================== */

export const whatsappDeleteTemplate = async (req, res) => {
    try {
        const { integrated_number, template_name, template_id } = req.query;
        const userId = getUserId(req);

        if (!userId) {
            return res
                .status(401)
                .json({ success: false, message: "User Not Found" });
        }

        if (!template_id || !mongoose.Types.ObjectId.isValid(template_id)) {
            return res.status(400).json({
                success: false,
                message: "Valid template_id is required"
            });
        }

        if (!integrated_number || !template_name) {
            return res.status(400).json({
                success: false,
                message: "integrated_number and template_name are required"
            });
        }

        // Find the template to verify ownership and check status
        const template = await Template.findOne({ _id: template_id, userId });

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        let providerResponse = null;

        // Only delete from MSG91 if it was submitted/approved/rejected and has an ID
        if (template.status !== "DRAFT" && template.msg91TemplateId) {
            try {
                const response = await axios.delete(
                    "https://control.msg91.com/api/v5/whatsapp/client-panel-template/",
                    {
                        params: { integrated_number, template_name },
                        headers: {
                            authkey: config.MSG91_AUTHKEY,
                            "Content-Type": "application/json"
                        },
                        timeout: 30000
                    }
                );
                providerResponse = response.data;
            } catch (apiError) {
                console.error("⚠️ MSG91 delete API error:", apiError?.response?.data || apiError.message);
                // Proceed with local deletion anyway to avoid getting stuck
                providerResponse = apiError?.response?.data || { error: apiError.message };
            }
        }

        // Soft-delete locally
        template.isDeleted = true;
        template.notFoundInMsg91 = true;
        await template.save();

        return res.json({
            success: true,
            message: "Template deleted successfully",
            providerResponse
        });
    } catch (error) {
        console.error("❌ Delete Template Error:", error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to delete template",
            providerError: error?.response?.data || null
        });
    }
};