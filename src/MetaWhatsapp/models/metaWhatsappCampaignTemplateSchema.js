import mongoose from "mongoose";

// ─── BUTTON SUB-SCHEMA ────────────────────────────────────────────────────────
// Matches ALL button types supported by Meta's WhatsApp Business Management API.
// Reference: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components#buttons
const buttonSchema = new mongoose.Schema(
    {
        // The button type — Meta supports these types across template categories
        type: {
            type: String,
            enum: [
                "QUICK_REPLY",   // Sends a predefined text reply back
                "URL",           // Opens a URL (supports dynamic {{1}} suffix)
                "PHONE_NUMBER",  // Initiates a phone call
                "COPY_CODE",     // Copies a coupon/promo code to clipboard
                "OTP",           // Authentication OTP button (COPY_CODE, ONE_TAP, ZERO_TAP)
                "FLOW",          // Launches a WhatsApp Flow (forms, surveys)
                "CATALOG",       // Opens the business product catalog
                "MPM",           // Multi-Product Message — shows product list
                "VOICE_CALL"     // Initiates a voice call via WhatsApp
            ],
            required: true
        },

        // Display text on the button (required for most types, max 25 chars)
        text: {
            type: String,
            maxlength: 25
        },

        // ── URL Button fields ──
        // The target URL — can contain {{1}} for dynamic suffix
        url: {
            type: String,
            validate: {
                validator: function (v) {
                    if (this.type !== "URL") return true;
                    return /^https?:\/\/.+/.test(v);
                },
                message: "URL button must have a valid http/https URL"
            }
        },
        // Example values for dynamic URL parameters (e.g., ["order-123"])
        // Meta requires this when URL contains {{1}}
        example: {
            type: [String],
            default: undefined,
            required: function () {
                return this.type === "URL" && this.url && this.url.includes("{{1}}");
            },
            validate: {
                validator: function (v) {
                    if (this.type === "URL" && this.url && this.url.includes("{{1}}")) {
                        return Array.isArray(v) && v.length > 0 && typeof v[0] === 'string' && v[0].trim().length > 0;
                    }
                    return true;
                },
                message: "An example is required when a URL button contains a {{1}} variable"
            }
        },

        // ── PHONE_NUMBER Button fields ──
        phoneNumber: {
            type: String,
            validate: {
                validator: function (v) {
                    if (this.type !== "PHONE_NUMBER") return true;
                    return /^\+?[1-9]\d{6,14}$/.test(v);
                },
                message: "Invalid phone number format"
            }
        },

        // ── OTP Button fields (AUTHENTICATION templates) ──
        // Sub-type: COPY_CODE (user copies code), ONE_TAP (auto-fill), ZERO_TAP (auto-verify)
        otpType: {
            type: String,
            enum: ["COPY_CODE", "ONE_TAP", "ZERO_TAP"],
            default: undefined
        },
        autofillText: {
            type: String,
            default: undefined
        },
        zeroTapTermsAccepted: {
            type: Boolean,
            default: undefined
        },
        supportedApps: {
            type: [{
                packageName: String,
                signatureHash: String
            }],
            default: undefined
        },

        // ── FLOW Button fields ──
        flowId: { type: String, default: undefined },
        flowName: { type: String, default: undefined },
        // "navigate" (opens a specific screen) or "data_exchange" (sends data)
        flowAction: {
            type: String,
            enum: ["navigate", "data_exchange"],
            default: undefined
        }
    },
    { _id: false }
);

// ─── HEADER EXAMPLE SUB-SCHEMA ────────────────────────────────────────────────
// Stores sample data that Meta requires for template review.
// For TEXT headers: header_text = ["sample value"]
// For MEDIA headers: header_handle = ["4::aW1hZ2UvanBlZw==..."] (from upload session)
const headerExampleSchema = new mongoose.Schema(
    {
        header_text: { type: [String], default: undefined },
        header_handle: { type: [String], default: undefined }
    },
    { _id: false }
);

// ─── HEADER SUB-SCHEMA ────────────────────────────────────────────────────────
// Matches Meta's HEADER component structure.
// TEXT headers support one {{1}} variable; MEDIA headers need a handle at submission time.
const headerSchema = new mongoose.Schema(
    {
        // The header format — determines what content is allowed
        format: {
            type: String,
            enum: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "NONE"],
            default: "NONE"
        },

        // Header text content (only for format=TEXT, max 60 chars)
        text: {
            type: String,
            maxlength: 60,
            validate: {
                validator: function (v) {
                    if (this.format !== "TEXT") return true;
                    return !!v && v.trim().length > 0;
                },
                message: "Header text is required when format is TEXT"
            }
        },

        // Upload handle for media headers (IMAGE/VIDEO/DOCUMENT)
        // Obtained from Meta's resumable upload API before template submission
        headerHandle: {
            type: String,
            default: undefined
        },

        // Default or uploaded media URL for IMAGE/VIDEO/DOCUMENT headers
        mediaUrl: {
            type: String,
            default: undefined
        },

        // Default filename for DOCUMENT headers
        defaultFilename: {
            type: String,
            default: undefined
        },

        // Example/sample data — required by Meta for template review
        // For TEXT: example values for {{1}} variable
        // For MEDIA: the uploaded handle reference
        example: headerExampleSchema
    },
    { _id: false }
);

// ─── AUTH CONFIG SUB-SCHEMA (AUTHENTICATION category only) ───────────────────
// Controls OTP-specific behavior for AUTHENTICATION templates.
// Reference: https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
const authConfigSchema = new mongoose.Schema(
    {
        // Adds "For your security, do not share this code" message
        addSecurityRecommendation: {
            type: Boolean,
            default: false
        },
        // Auto-expiry countdown shown in the message (1-90 minutes)
        codeExpirationMinutes: {
            type: Number,
            min: 1,
            max: 90,
            default: null
        }
    },
    { _id: false }
);

// ─── CAROUSEL CARD SUB-SCHEMA ───────────────────────────────────────────────
// Represents a single card in a Meta CAROUSEL template.
const carouselCardSchema = new mongoose.Schema(
    {
        id: { type: Number },
        headerHandle: { type: String, default: undefined },
        body: { type: String, required: true, maxlength: 160 },
        buttons: {
            type: [buttonSchema],
            validate: {
                validator: (v) => v.length <= 2,
                message: "Maximum 2 buttons allowed per carousel card"
            }
        }
    },
    { _id: false }
);

// ─── TEMPLATE SCHEMA ──────────────────────────────────────────────────────────
// Main schema for WhatsApp message templates.
// Mirrors the Meta Business Management API template object structure.
// Reference: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
const metaWhatsappTemplateSchema = new mongoose.Schema(
    {
        // ── Ownership ──
        // Links this template to a user and their connected WhatsApp number
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        numberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsAppToken",
            required: true,
            index: true
        },

        // ── Identity ──
        // Template name must follow Meta's naming rules: lowercase, underscores, no spaces
        name: {
            type: String,
            required: [true, "Template name is required"],
            trim: true,
            lowercase: true,
            maxlength: [512, "Template name cannot exceed 512 characters"],
            match: [
                /^[a-z0-9_]+$/,
                "Template name can only contain lowercase letters, numbers, and underscores"
            ]
        },

        // Local version counter — incremented when cloning
        version: {
            type: Number,
            default: 1,
            min: 1
        },

        // ── Meta Classification ──
        // Meta requires every template to be categorized for billing and policy
        category: {
            type: String,
            enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
            required: [true, "Template category is required"]
        },

        // BCP-47 language code (e.g., "en", "en_US", "hi", "mr")
        language: {
            type: String,
            default: "en",
            trim: true
        },

        // Utility Template sub-type
        utilityType: {
            type: String,
            enum: ["CUSTOM", "CALL_REQUEST_PERMISSION"],
            default: undefined
        },
        
        // Variable formatting type for Utility templates
        variableType: {
            type: String,
            enum: ["NUMBER", "TEXT"],
            default: undefined
        },

        // Marketing Template sub-type
        marketingType: {
            type: String,
            enum: ["CUSTOM", "PRODUCT", "CAROUSEL", "LIMITED_TIME_OFFER", "CALL_REQUEST_PERMISSION"],
            default: undefined
        },

        // Offer message for LIMITED_TIME_OFFER
        offerMessage: {
            type: String,
            default: undefined
        },

        // ── Content Components ──

        // HEADER: Optional first line — text, image, video, or document
        header: headerSchema,

        // BODY: The main message content (max 1024 chars)
        // Supports variables like {{1}}, {{2}} for personalization
        body: {
            type: String,
            maxlength: [1024, "Body cannot exceed 1024 characters"]
        },

        // FOOTER: Optional small text at the bottom (max 60 chars)
        footer: {
            type: String,
            maxlength: [60, "Footer cannot exceed 60 characters"]
        },

        // BUTTONS: Interactive elements (max 10)
        buttons: {
            type: [buttonSchema],
            validate: {
                validator: (v) => v.length <= 10,
                message: "Maximum 10 buttons allowed"
            }
        },

        // CAROUSEL CARDS: Cards for carousel templates (2 to 10 cards)
        carouselCards: {
            type: [carouselCardSchema],
            default: undefined
        },

        // ── Sample / Example Data ──
        // Meta REQUIRES example values for templates with variables.
        // Without these, Meta rejects the template during review.
        // Format: [["value_for_{{1}}", "value_for_{{2}}"]]
        // e.g., body = "Hello {{1}}, your order {{2}} ships today"
        //        bodySamples = [["John", "ORD-12345"]]
        bodySamples: {
            type: [[String]],
            default: undefined
        },

        // ── Variables (auto-detected from body on save) ──
        // Counts unique {{N}} placeholders in the body text
        variablesCount: {
            type: Number,
            default: 0,
            min: 0
        },

        // ── Meta Integration ──
        // The template ID returned by Meta after successful submission
        metaTemplateId: {
            type: String,
            index: true,
            sparse: true,
            default: null
        },

        // Meta's quality score for this template (affects delivery)
        // GREEN = good, YELLOW = watch, RED = at risk of being paused
        qualityScore: {
            type: String,
            enum: ["UNKNOWN", "RED", "YELLOW", "GREEN"],
            default: "UNKNOWN"
        },
        
        qualityHistory: [{
            event: { type: String, enum: ["FLAGGED", "PAUSED", "DISABLED", "APPROVED", "UNFLAGGED"] },
            reason: String,
            timestamp: Date,
            pauseDuration: Number,  // hours
            autoResumedAt: Date
        }],

        // The UNIX timestamp when Meta last scored the template quality
        qualityScoreDate: {
            type: Date,
            default: null
        },
        
        pauseCount: { type: Number, default: 0 },
        isPaused: { type: Boolean, default: false },
        isDisabledByMeta: { type: Boolean, default: false },
        disabledAt: { type: Date, default: null },

        // ── Status Lifecycle ──
        // Tracks the template through its entire lifecycle from draft to Meta approval.
        // DRAFT          → saved locally, not submitted to Meta
        // SUBMITTED      → sent to Meta API, awaiting initial response
        // PENDING        → Meta is reviewing the template
        // APPROVED       → Meta approved — ready to use for sending
        // REJECTED       → Meta rejected — check rejectionReason
        // PAUSED         → Meta paused due to quality issues
        // DISABLED       → manually disabled by user
        // IN_APPEAL      → rejection appealed, under Meta re-review
        // LIMIT_EXCEEDED → account template limit reached
        status: {
            type: String,
            enum: [
                "DRAFT",
                "SUBMITTED",
                "PENDING",
                "APPROVED",
                "REJECTED",
                "PAUSED",
                "DISABLED",
                "IN_APPEAL",
                "LIMIT_EXCEEDED",
                "PENDING_DELETION"
            ],
            default: "DRAFT",
            index: true
        },

        // Meta's reason for rejecting the template (e.g., "ABUSIVE_CONTENT")
        rejectionReason: {
            type: String,
            default: null
        },

        // ── Meta Submission Options ──
        // Time-to-live in seconds for messages using this template (Meta default: 2592000 = 30d)
        // For MM Lite: 43200 (12h) min, 2592000 (30d) max
        messageSendTtlSeconds: {
            type: Number,
            default: null,
            min: 43200,
            max: 2592000
        },

        useMMLite: { type: Boolean, default: false },

        // Whether to allow Meta to auto-categorize the template
        // If true, Meta may change the category from what you submitted
        allowCategoryChange: {
            type: Boolean,
            default: false
        },

        // ── AUTHENTICATION-specific config ──
        // TTL for OTP messages (separate from messageSendTtlSeconds)
        ttl: {
            type: Number,
            default: null,
            min: 0
        },

        authConfig: authConfigSchema,

        // ── Guards ──
        // Prevents editing of approved/submitted templates
        isLocked: {
            type: Boolean,
            default: false
        },

        // Soft-delete flag — template is hidden but not removed from DB
        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },

        // ── Meta sync flag ──
        // Set to true when a local template is no longer found in Meta's response
        // (e.g., deleted from Meta Business Manager directly)
        notFoundInMeta: {
            type: Boolean,
            default: false
        },

        // ── Submission error (if Meta API call failed) ──
        // Stores the error message from the last failed submission attempt
        submissionError: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// ─── COMPOUND INDEXES ─────────────────────────────────────────────────────────
// Optimized for the most common query patterns in the application
metaWhatsappTemplateSchema.index({ userId: 1, isDeleted: 1, status: 1 });
metaWhatsappTemplateSchema.index({ userId: 1, name: 1, version: -1 });
metaWhatsappTemplateSchema.index({ numberId: 1, status: 1 });
metaWhatsappTemplateSchema.index({ numberId: 1, name: 1, language: 1, isDeleted: 1 });

// ─── VIRTUALS ─────────────────────────────────────────────────────────────────
// isReady: true when the template can be used to send messages
// Requires: APPROVED status + not deleted
metaWhatsappTemplateSchema.virtual("isReady").get(function () {
    return this.status === "APPROVED" && !this.isDeleted;
});

// ─── PRE-SAVE: AUTO VARIABLE DETECTION ───────────────────────────────────────
// Scans the body text for {{N}} placeholders and counts unique variables.
// This runs automatically whenever the body field is modified.
metaWhatsappTemplateSchema.pre("save", function (next) {
    // Helper to validate sequential variables starting at 1
    const validateVars = (text, componentName) => {
        if (!text) return null;
        
        // 1. Meta Rule: Variables cannot be at the absolute start or end
        const trimmedText = text.trim();
        if (trimmedText.startsWith("{{") && trimmedText.match(/^\{\{\d+\}\}/)) {
            return `${componentName} cannot start with a variable. Meta requires text before the variable.`;
        }
        if (trimmedText.endsWith("}}") && trimmedText.match(/\{\{\d+\}\}$/)) {
            return `${componentName} cannot end with a variable. Meta requires text or punctuation after the variable.`;
        }

        // 2. Meta Rule: Variables cannot be consecutive without text in between
        if (trimmedText.match(/\{\{\d+\}\}\s*\{\{\d+\}\}/)) {
            return `${componentName} cannot have variables next to each other. Add text between them.`;
        }

        const matches = text.match(/\{\{(\d+)\}\}/g);
        if (!matches) return null;
        
        const nums = Array.from(new Set(matches.map((m) => parseInt(m.replace(/[{}]/g, ""), 10)))).sort((a, b) => a - b);
        
        if (nums.length > 0 && nums[0] !== 1) {
            return `${componentName} variables must start at {{1}}. Found {{${nums[0]}}}. Meta requires independent numbering per component.`;
        }
        for (let i = 0; i < nums.length; i++) {
            if (nums[i] !== i + 1) {
                return `${componentName} variables must be sequential ({{1}}, {{2}}, etc). Missing {{${i + 1}}}.`;
            }
        }
        return null;
    };

    // Validate Body Variables
    const bodyError = validateVars(this.body, "Body");
    if (bodyError) return next(new Error(bodyError));

    // Validate Text Header Variables
    if (this.header?.format === "TEXT") {
        const headerError = validateVars(this.header.text, "Header");
        if (headerError) return next(new Error(headerError));
    }

    // Auto-calculate variables count from the body text
    if (this.body) {
        const matches = this.body.match(/\{\{(\d+)\}\}/g);
        if (matches) {
            const uniqueVars = new Set(matches.map((m) => m.replace(/[{}]/g, "")));
            this.variablesCount = uniqueVars.size;
        } else {
            this.variablesCount = 0;
        }
    }
    next();
});

// ─── PRE-SAVE: ENFORCE NAME FORMAT ───────────────────────────────────────────
// Meta requires template names to be lowercase with underscores only.
// This hook auto-converts spaces to underscores and lowercases the name.
metaWhatsappTemplateSchema.pre("save", function (next) {
    if (this.isModified("name")) {
        this.name = this.name.toLowerCase().replace(/\s+/g, "_");
    }
    next();
});

// ─── PRE-SAVE: LOCK APPROVED TEMPLATES (REMOVED) ─────────────────────────────
// Meta allows editing templates even if they are APPROVED or PENDING.
// Editing an approved template changes its status back to PENDING.
metaWhatsappTemplateSchema.pre("save", function (next) {
    next();
});

// ─── PRE-SAVE: AUTH TEMPLATE GUARD ───────────────────────────────────────────
// Strips AUTHENTICATION-only fields from non-AUTH templates to keep data clean.
metaWhatsappTemplateSchema.pre("save", function (next) {
    if (this.category !== "AUTHENTICATION") {
        this.ttl = undefined;
        this.authConfig = undefined;
    }
    next();
});

// ─── PRE-SAVE: UTILITY TEMPLATE GUARD ────────────────────────────────────────
metaWhatsappTemplateSchema.pre("save", function (next) {
    if (this.category !== "UTILITY") {
        this.utilityType = undefined;
    }
    if (this.category !== "UTILITY" && this.category !== "MARKETING") {
        this.variableType = undefined;
    }
    
    const isCallRequest = 
        (this.category === "UTILITY" && this.utilityType === "CALL_REQUEST_PERMISSION") ||
        (this.category === "MARKETING" && this.marketingType === "CALL_REQUEST_PERMISSION");
        
    if (isCallRequest) {
        // Meta forbids custom buttons for Call Request Permission templates.
        if (this.buttons && this.buttons.length > 0) {
            return next(new Error("Call Request Permission templates cannot have custom buttons."));
        }
    }
    next();
});

// ─── STATIC: FIND ACTIVE TEMPLATES ───────────────────────────────────────────
// Returns all non-deleted templates for a user, sorted newest-first.
metaWhatsappTemplateSchema.statics.findActive = function (userId, filter = {}) {
    return this.find({
        userId,
        isDeleted: false,
        ...filter
    }).sort({ createdAt: -1 });
};

// ─── STATIC: SOFT DELETE ─────────────────────────────────────────────────────
// Marks a template as deleted and unlocks it (in case it was approved).
metaWhatsappTemplateSchema.statics.softDelete = function (id, userId) {
    return this.findOneAndUpdate(
        { _id: id, userId, isDeleted: false },
        { isDeleted: true, isLocked: false },
        { new: true }
    );
};

// ─── INSTANCE: TO META PAYLOAD ───────────────────────────────────────────────
// Converts the Mongoose document into the exact JSON structure that
// Meta's POST /{waba_id}/message_templates endpoint expects.
// Reference: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates#create-templates
metaWhatsappTemplateSchema.methods.toMetaPayload = function () {
    const components = [];

    // ── HEADER COMPONENT ──
    // Build the header based on format type. TEXT headers include text content;
    // MEDIA headers (IMAGE/VIDEO/DOCUMENT) include the upload handle as an example.
    // Carousel templates DO NOT have a top-level header component.
    if (this.header && this.header.format !== "NONE" && this.marketingType !== "CAROUSEL") {
        const headerComp = {
            type: "HEADER",
            format: this.header.format
        };

        if (this.header.format === "TEXT") {
            // Text header — include the text and any variable examples
            headerComp.text = this.header.text;
            if (this.header.example?.header_text?.length) {
                headerComp.example = { header_text: this.header.example.header_text };
            }
        } else {
            // Media header (IMAGE/VIDEO/DOCUMENT) — include the upload handle
            // The handle is obtained from Meta's resumable upload API
            if (this.header.headerHandle) {
                headerComp.example = { header_handle: [this.header.headerHandle] };
            } else if (this.header.example?.header_handle?.length) {
                headerComp.example = { header_handle: this.header.example.header_handle };
            }
        }

        components.push(headerComp);
    }

    // ── BODY COMPONENT ──
    // The main message text. If the template uses variables ({{1}}, {{2}}),
    // example values MUST be provided or Meta will reject the template.
    const bodyComponent = { type: "BODY" };
    
    if (this.category !== "AUTHENTICATION") {
        bodyComponent.text = this.body;
    }

    // For AUTHENTICATION templates, add the security recommendation flag
    if (this.category === "AUTHENTICATION" && this.authConfig?.addSecurityRecommendation) {
        bodyComponent.add_security_recommendation = true;
    }

    // Attach body variable examples if present
    // Meta format: example.body_text = [["value1", "value2"]]
    if (this.bodySamples?.length > 0 && this.category !== "AUTHENTICATION") {
        const cleanSamples = Array.isArray(this.bodySamples[0]) ? this.bodySamples : [this.bodySamples];
        bodyComponent.example = { body_text: cleanSamples };
    }

    if (bodyComponent.text || bodyComponent.add_security_recommendation) {
        components.push(bodyComponent);
    }

    // ── FOOTER COMPONENT ──
    // Optional small text at the bottom of the message
    // Note: Meta strictly forbids footers when using the LIMITED_TIME_OFFER component.
    const isLimitedTimeOffer = this.category === "MARKETING" && this.marketingType === "LIMITED_TIME_OFFER";
    if (this.footer && !isLimitedTimeOffer) {
        components.push({ type: "FOOTER", text: this.footer });
    }

    // ── LIMITED TIME OFFER COMPONENT ──
    if (this.category === "MARKETING" && this.marketingType === "LIMITED_TIME_OFFER" && this.offerMessage) {
        components.push({
            type: "LIMITED_TIME_OFFER",
            limited_time_offer: {
                text: this.offerMessage,
                has_expiration: true
            }
        });
    }

    // ── BUTTONS COMPONENT ──
    // Maps each button to the Meta API format based on its type.
    // Different button types require different fields in the payload.
    if (this.buttons?.length > 0) {
        const metaButtons = this.buttons.map((b) => {
            const btn = { type: b.type };

            // Most buttons have display text
            if (b.text) btn.text = b.text;

            switch (b.type) {
                case "URL":
                    // URL buttons open a link — can have dynamic {{1}} suffix
                    btn.url = b.url;
                    if (b.example?.length) btn.example = b.example;
                    break;

                case "PHONE_NUMBER":
                    // Phone buttons initiate a call. Meta requires a '+' prefix and country code.
                    let phoneStr = b.phoneNumber.replace(/\D/g, ""); // Strip any non-digits just in case
                    if (phoneStr.length === 10) {
                        phoneStr = "91" + phoneStr; // Auto-add India code if it's a 10-digit number
                    }
                    btn.phone_number = `+${phoneStr}`;
                    break;

                case "OTP":
                    // OTP buttons for AUTHENTICATION templates
                    btn.otp_type = b.otpType || "COPY_CODE";
                    if (b.otpType === "ZERO_TAP" || b.otpType === "ONE_TAP") {
                        btn.autofill_text = b.autofillText || "Autofill";
                        if (b.supportedApps && b.supportedApps.length > 0) {
                            btn.supported_apps = b.supportedApps.map(app => ({
                                package_name: app.packageName,
                                signature_hash: app.signatureHash
                            })).filter(app => app.package_name && app.signature_hash);
                        }
                        if (b.otpType === "ZERO_TAP" && b.zeroTapTermsAccepted) {
                            btn.zero_tap_terms_accepted = true;
                        }
                    }
                    break;

                case "FLOW":
                    // Flow buttons launch WhatsApp Flows
                    if (b.flowId) btn.flow_id = b.flowId;
                    if (b.flowName) btn.flow_name = b.flowName;
                    if (b.flowAction) btn.flow_action = b.flowAction;
                    break;

                case "COPY_CODE":
                    // Copy code buttons — the code is provided at send time
                    if (b.example?.length) btn.example = b.example[0];
                    // Meta strictly forbids the 'text' property for COPY_CODE in Marketing/Utility templates
                    delete btn.text;
                    break;

                case "CATALOG":
                case "MPM":
                    // These buttons use fixed text provided by Meta ("View catalog", etc.)
                    delete btn.text;
                    break;

                // QUICK_REPLY, VOICE_CALL — only need type + text
                default:
                    break;
            }

            return btn;
        });

        components.push({ type: "BUTTONS", buttons: metaButtons });
    }

    // ── AUTH CONFIG (AUTHENTICATION templates only) ──
    // Adds OTP-specific components: security recommendation and code expiration
    if (this.category === "AUTHENTICATION" && this.authConfig) {
        // Add code expiration footer if configured
        if (this.authConfig.codeExpirationMinutes) {
            components.push({
                type: "FOOTER",
                code_expiration_minutes: this.authConfig.codeExpirationMinutes
            });
        }

        // Add OTP button if not already added via the buttons array
        const hasOtpButton = this.buttons?.some(b => b.type === "OTP");
        if (!hasOtpButton) {
            components.push({
                type: "BUTTONS",
                buttons: [{
                    type: "OTP",
                    otp_type: "COPY_CODE",
                    text: "Copy Code"
                }]
            });
        }
    }

    // ── CAROUSEL COMPONENT ──
    if (this.category === "MARKETING" && this.marketingType === "CAROUSEL" && this.carouselCards?.length > 0) {
        const carouselComp = {
            type: "CAROUSEL",
            cards: this.carouselCards.map(card => {
                const cardComponents = [];
                
                // Card Header (Meta requires format, e.g. IMAGE/VIDEO)
                // We use this.header.format if present (the backend doesn't store carouselHeaderType natively, 
                // but if we store it in this.header.format, we use that).
                // Wait, if this.header.format is NONE, it's invalid for Carousel cards (they MUST have a media header).
                // Let's assume the frontend will send it in header.format.
                const headerFormat = this.header?.format || "IMAGE";
                if (headerFormat !== "NONE") {
                    const cardHeader = { type: "HEADER", format: headerFormat };
                    if (card.headerHandle) {
                        cardHeader.example = { header_handle: [card.headerHandle] };
                    }
                    cardComponents.push(cardHeader);
                }

                // Card Body
                if (card.body) {
                    cardComponents.push({ type: "BODY", text: card.body });
                }

                // Card Buttons
                if (card.buttons?.length > 0) {
                    const cardBtns = card.buttons.map(b => {
                        const btn = { type: b.type };
                        if (b.text) btn.text = b.text;
                        if (b.type === "URL") {
                            btn.url = b.url;
                            if (b.example?.length) btn.example = b.example;
                        } else if (b.type === "PHONE_NUMBER") {
                            let phoneStr = b.phoneNumber.replace(/\D/g, "");
                            if (phoneStr.length === 10) phoneStr = "91" + phoneStr;
                            btn.phone_number = `+${phoneStr}`;
                        }
                        return btn;
                    });
                    cardComponents.push({ type: "BUTTONS", buttons: cardBtns });
                }

                return { components: cardComponents };
            })
        };
        components.push(carouselComp);
    }

    // ── Build the final payload ──
    const payload = {
        name: this.name,
        category: this.category,
        language: this.language,
        components
    };

    // allow_category_change lets Meta re-categorize if they disagree with yours
    if (this.allowCategoryChange) {
        payload.allow_category_change = true;
    }

    // message_send_ttl_seconds — how long Meta will attempt delivery
    if (this.messageSendTtlSeconds) {
        payload.message_send_ttl_seconds = this.messageSendTtlSeconds;
    }

    return payload;
};

// ─── INSTANCE: GET REQUIRED VARIABLES ─────────────────────────────────────────
// Returns an array of dynamic variable specifications required by this template.
// Fully aligns with frontend variable key expectations (header_text, header_url, body_1..N, button_1, card_X_header_url, etc.)
metaWhatsappTemplateSchema.methods.getRequiredVariables = function () {
    const vars = [];

    // Header
    if (this.header) {
        const hFormat = (this.header.format || "NONE").toUpperCase();
        if (hFormat === "TEXT" && this.header.text?.includes("{{1}}")) {
            vars.push({
                key: "header_text",
                component: "HEADER",
                type: "text",
                label: "Header Text Variable {{1}}",
                required: true
            });
        } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(hFormat)) {
            vars.push({
                key: "header_url",
                component: "HEADER",
                type: "media",
                format: hFormat,
                label: `Header ${hFormat} URL`,
                required: !this.header.mediaUrl && !this.header.headerHandle
            });
            if (hFormat === "DOCUMENT") {
                vars.push({
                    key: "header_filename",
                    component: "HEADER",
                    type: "text",
                    label: "Header Document Filename",
                    required: false
                });
            }
        } else if (hFormat === "LOCATION") {
            vars.push({ key: "header_latitude", component: "HEADER", type: "location", label: "Latitude", required: true });
            vars.push({ key: "header_longitude", component: "HEADER", type: "location", label: "Longitude", required: true });
            vars.push({ key: "header_location_name", component: "HEADER", type: "location", label: "Location Name", required: false });
            vars.push({ key: "header_location_address", component: "HEADER", type: "location", label: "Location Address", required: false });
        }
    }

    // Body
    if (this.body) {
        const matches = [...this.body.matchAll(/\{\{(\d+)\}\}/g)];
        const uniqueNums = [...new Set(matches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);
        uniqueNums.forEach(n => {
            vars.push({
                key: `body_${n}`,
                component: "BODY",
                type: "text",
                index: n,
                label: `Body Variable {{${n}}}`,
                required: true
            });
        });
    }

    // Buttons
    if (this.buttons && this.buttons.length > 0) {
        this.buttons.forEach((btn, idx) => {
            const btnNum = idx + 1;
            if (btn.type === "URL" && btn.url?.includes("{{1}}")) {
                vars.push({
                    key: `button_${btnNum}`,
                    component: "BUTTON",
                    type: "url_suffix",
                    buttonType: "URL",
                    index: idx,
                    label: `Button ${btnNum} URL Suffix`,
                    required: true
                });
            } else if (btn.type === "COPY_CODE") {
                vars.push({
                    key: `button_${btnNum}`,
                    component: "BUTTON",
                    type: "coupon_code",
                    buttonType: "COPY_CODE",
                    index: idx,
                    label: `Button ${btnNum} Coupon Code`,
                    required: true
                });
            } else if (btn.type === "QUICK_REPLY") {
                vars.push({
                    key: `button_${btnNum}_payload`,
                    component: "BUTTON",
                    type: "payload",
                    buttonType: "QUICK_REPLY",
                    index: idx,
                    label: `Button ${btnNum} Payload`,
                    required: false
                });
            }
        });
    }

    // Carousel Cards
    if (this.marketingType === "CAROUSEL" && this.carouselCards && this.carouselCards.length > 0) {
        this.carouselCards.forEach((card, cardIdx) => {
            const cardNum = cardIdx + 1;
            const hFormat = (this.header?.format || "IMAGE").toUpperCase();
            vars.push({
                key: `card_${cardIdx}_header_url`,
                component: "CAROUSEL_CARD",
                cardIndex: cardIdx,
                type: "media",
                format: hFormat,
                label: `Card ${cardNum} Header ${hFormat} URL`,
                required: true
            });

            if (card.body) {
                const matches = [...card.body.matchAll(/\{\{(\d+)\}\}/g)];
                const uniqueNums = [...new Set(matches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);
                uniqueNums.forEach(n => {
                    vars.push({
                        key: `card_${cardIdx}_body_${n}`,
                        component: "CAROUSEL_CARD",
                        cardIndex: cardIdx,
                        type: "text",
                        index: n,
                        label: `Card ${cardNum} Body Variable {{${n}}}`,
                        required: true
                    });
                });
            }
        });
    }

    return vars;
};

// ─── INSTANCE: BUILD SEND COMPONENTS ──────────────────────────────────────────
// Converts dynamic recipient variables into Meta Cloud API v25.0 message components payload.
// Preserves exact approved template structure and text without post-creation modifications.
metaWhatsappTemplateSchema.methods.buildSendComponents = function (recipientVariables = {}) {
    const getVar = (key) => {
        if (!recipientVariables) return "";
        if (typeof recipientVariables.get === "function") {
            return recipientVariables.get(key) || "";
        }
        return recipientVariables[key] || "";
    };

    const components = [];

    // 1. HEADER Component
    if (this.header && this.header.format && this.header.format !== "NONE" && this.marketingType !== "CAROUSEL") {
        const headerFormat = this.header.format.toUpperCase();
        const headerParams = [];

        if (headerFormat === "TEXT") {
            if (this.header.text?.includes("{{1}}")) {
                const val = getVar("header_text") || getVar("header_1") || getVar("body_1") || this.header.example?.header_text?.[0] || "";
                if (val !== undefined && val !== null) {
                    headerParams.push({ type: "text", text: String(val) });
                }
            }
        } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
            const url = getVar("header_url") || getVar("header_media_url") || this.header.mediaUrl;
            if (url) {
                const mediaObj = { link: url };
                if (headerFormat === "DOCUMENT") {
                    const filename = getVar("header_filename") || this.header.defaultFilename;
                    if (filename) mediaObj.filename = filename;
                }
                headerParams.push({
                    type: headerFormat.toLowerCase(),
                    [headerFormat.toLowerCase()]: mediaObj
                });
            }
        } else if (headerFormat === "LOCATION") {
            const lat = getVar("header_latitude");
            const lng = getVar("header_longitude");
            if (lat && lng) {
                const locObj = {
                    latitude: String(lat),
                    longitude: String(lng)
                };
                const name = getVar("header_location_name");
                const address = getVar("header_location_address");
                if (name) locObj.name = name;
                if (address) locObj.address = address;
                headerParams.push({ type: "location", location: locObj });
            }
        }

        if (headerParams.length > 0) {
            components.push({
                type: "header",
                parameters: headerParams
            });
        }
    }

    // 2. BODY Component
    if (this.category !== "AUTHENTICATION" && this.body) {
        const bodyParams = [];
        const matches = [...this.body.matchAll(/\{\{(\d+)\}\}/g)];
        const uniqueNums = [...new Set(matches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);

        if (uniqueNums.length > 0) {
            uniqueNums.forEach((n, idx) => {
                let val = getVar(`body_${n}`) || getVar(String(n));
                if ((val === undefined || val === null || val === "") && this.bodySamples?.[0]?.[idx]) {
                    val = this.bodySamples[0][idx];
                }
                bodyParams.push({ type: "text", text: String(val ?? "") });
            });

            if (bodyParams.length > 0) {
                components.push({
                    type: "body",
                    parameters: bodyParams
                });
            }
        }
    }

    // 3. BUTTONS Component
    if (this.buttons && this.buttons.length > 0) {
        this.buttons.forEach((btn, idx) => {
            const btnNum = idx + 1;
            let paramObj = null;

            if (btn.type === "URL" && btn.url?.includes("{{1}}")) {
                const val = getVar(`button_${btnNum}`) || getVar(`button_${idx}`) || getVar("button_1") || btn.example?.[0] || "";
                if (val !== undefined && val !== null) {
                    paramObj = { type: "text", text: String(val) };
                }
            } else if (btn.type === "COPY_CODE") {
                const val = getVar(`button_${btnNum}`) || getVar("button_copy_code") || getVar("coupon_code") || btn.example?.[0] || "PROMO";
                paramObj = { type: "coupon_code", coupon_code: String(val) };
            } else if (btn.type === "QUICK_REPLY") {
                const val = getVar(`button_${btnNum}_payload`) || getVar(`button_${idx}_payload`);
                if (val) {
                    paramObj = { type: "payload", payload: String(val) };
                }
            } else if (["CATALOG", "MPM"].includes(btn.type)) {
                const val = getVar(`button_${btnNum}_product_id`);
                if (val) {
                    paramObj = { type: "action", action: { thumbnail_product_retailer_id: String(val) } };
                }
            }

            if (paramObj) {
                components.push({
                    type: "button",
                    sub_type: btn.type.toLowerCase(),
                    index: String(idx),
                    parameters: [paramObj]
                });
            }
        });
    }

    // 4. LIMITED TIME OFFER Component
    if (this.marketingType === "LIMITED_TIME_OFFER") {
        const expirationMs = Number(getVar("offer_expiration_time_ms")) || (Date.now() + 24 * 60 * 60 * 1000);
        components.push({
            type: "limited_time_offer",
            parameters: [
                {
                    type: "limited_time_offer",
                    limited_time_offer: { expiration_time_ms: expirationMs }
                }
            ]
        });
    }

    // 5. CAROUSEL Component
    if (this.marketingType === "CAROUSEL" && this.carouselCards && this.carouselCards.length > 0) {
        const cards = this.carouselCards.map((card, cardIdx) => {
            const cardComponents = [];
            const headerFormat = (this.header?.format || "IMAGE").toLowerCase();

            const cardMediaUrl = getVar(`card_${cardIdx}_header_url`) || getVar(`carousel_card_${cardIdx}_header_url`) || card.headerHandle;
            if (cardMediaUrl) {
                cardComponents.push({
                    type: "header",
                    parameters: [
                        {
                            type: headerFormat,
                            [headerFormat]: { link: cardMediaUrl }
                        }
                    ]
                });
            }

            if (card.body) {
                const matches = [...card.body.matchAll(/\{\{(\d+)\}\}/g)];
                const uniqueNums = [...new Set(matches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);
                if (uniqueNums.length > 0) {
                    const cardBodyParams = uniqueNums.map(n => {
                        const val = getVar(`card_${cardIdx}_body_${n}`) || "";
                        return { type: "text", text: String(val) };
                    });
                    cardComponents.push({
                        type: "body",
                        parameters: cardBodyParams
                    });
                }
            }

            if (card.buttons && card.buttons.length > 0) {
                card.buttons.forEach((cBtn, bIdx) => {
                    if (cBtn.type === "URL" && cBtn.url?.includes("{{1}}")) {
                        const val = getVar(`card_${cardIdx}_button_${bIdx}_url`) || "";
                        cardComponents.push({
                            type: "button",
                            sub_type: "url",
                            index: String(bIdx),
                            parameters: [{ type: "text", text: String(val) }]
                        });
                    }
                });
            }

            return {
                card_index: String(cardIdx),
                components: cardComponents
            };
        });

        components.push({
            type: "carousel",
            cards: cards
        });
    }

    return components;
};

export default mongoose.model("WhatsappTemplateSchema", metaWhatsappTemplateSchema);