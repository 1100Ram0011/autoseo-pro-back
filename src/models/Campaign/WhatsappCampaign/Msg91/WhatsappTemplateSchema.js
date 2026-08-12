import mongoose from "mongoose";

const buttonSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["QUICK_REPLY", "URL", "PHONE"],
            required: true
        },
        text: { type: String, required: true },
        url: String,
        phone: String,
        urlSamples: {
            type: [String],
            default: []
        },
        payload: { type: String }
    },
    { _id: false }
);

const templateSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        name: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },

        version: {
            type: Number,
            default: 1
        },

        category: {
            type: String,
            enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
            required: true
        },

        marketingType: {
            type: String,
            enum: ["Custom", "Product", "Carousel"],
            default: "Custom"
        },

        carouselCards: [{
            header: {
                type: {
                    type: String,
                    enum: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "NONE"],
                    default: "NONE"
                },
                text: String,
                mediaUrl: String
            },
            body: String,
            bodySamples: {
                type: [String],
                default: []
            },
            buttons: [buttonSchema]
        }],

        language: {
            type: String,
            default: "en"
        },

        // MSG91 namespace (returned during sync, not user-editable)
        namespace: {
            type: String,
            default: null
        },

        // MSG91 parameter_format: POSITIONAL | NAMED
        parameterFormat: {
            type: String,
            enum: ["POSITIONAL", "NAMED", null],
            default: null
        },

        header: {
            type: {
                type: String,
                enum: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "NONE"],
                default: "NONE"
            },
            text: String,
            mediaUrl: String,
            headerSamples: {
                type: [String],
                default: []
            }
        },

        // body is not globally required — synced templates may have an empty body
        // Required check is enforced at submit time in the controller
        body: {
            type: String,
            default: ""
        },

        footer: {
            type: String,
            default: null
        },

        buttons: [buttonSchema],

        // Count of {{1}}, {{2}} … placeholders in body
        variablesCount: {
            type: Number,
            default: 0
        },

        // Sample values for body variables e.g. ["John", "Order #123"]
        bodySamples: {
            type: [String],
            default: []
        },

        msg91TemplateId: {
            type: String,
            index: true
        },

        wabaNumber: {
            type: String,
            required: true
        },

        status: {
            type: String,
            enum: [
                "DRAFT",
                "SUBMITTED",
                "PENDING",
                "APPROVED",
                "REJECTED",
                "DISABLED"
            ],
            default: "DRAFT"
        },

        rejectionReason: {
            type: String,
            default: null
        },

        ttl: {
            type: Number,
            default: null
        },

        authConfig: {
            addSecurityRecommendation: {
                type: Boolean,
                default: false
            },
            codeExpirationMinutes: {
                type: Number,
                default: null
            }
        },

        // Raw components array from MSG91 (HEADER | BODY | FOOTER | BUTTONS)
        // Stored so frontend can render the original structure without re-fetching
        _msg91Components: {
            type: [mongoose.Schema.Types.Mixed],
            default: []
        },

        isLocked: {
            type: Boolean,
            default: false
        },

        isDeleted: {
            type: Boolean,
            default: false
        },

        notFoundInMsg91: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

/* ── INDEXES ─────────────────────────────────────────────────────────── */
templateSchema.index({ userId: 1, name: 1, version: -1 });
templateSchema.index({ userId: 1, wabaNumber: 1 });
templateSchema.index({ userId: 1, status: 1 });

/* ── LOCK APPROVED TEMPLATE ──────────────────────────────────────────── */
templateSchema.pre("save", function (next) {
    // Allow the isLocked field itself to be set to true (e.g. on submit)
    if (this.isModified("isLocked") && this.isLocked === true) {
        return next();
    }

    // Block any other modification once locked
    if (this.isLocked && this.isModified()) {
        const allowedPaths = ["isDeleted", "notFoundInMsg91"];
        const modifiedPaths = this.modifiedPaths();
        const hasDisallowedModification = modifiedPaths.some(
            (path) => !allowedPaths.includes(path)
        );

        if (hasDisallowedModification) {
            return next(new Error("Approved templates cannot be modified"));
        }
    }

    next();
});

/* ── AUTO VARIABLE DETECTION & REINDEXING ────────────────────────────── */
templateSchema.pre("save", function (next) {
    let globalIndex = 1;

    // Reindex variables in header text
    if (this.header && this.header.text) {
        this.header.text = this.header.text.replace(/{{\d+}}/g, () => `{{${globalIndex++}}}`);
    }

    // Reindex variables in body
    if (this.body) {
        this.body = this.body.replace(/{{\d+}}/g, () => `{{${globalIndex++}}}`);
    }

    // Reindex variables in button URLs
    if (Array.isArray(this.buttons)) {
        this.buttons.forEach((btn) => {
            if (btn.type === "URL" && btn.url) {
                btn.url = btn.url.replace(/{{\d+}}/g, () => `{{${globalIndex++}}}`);
            }
        });
    }

    // Reindex variables in Carousel Cards
    if (Array.isArray(this.carouselCards)) {
        this.carouselCards.forEach((card) => {
            if (card.header && card.header.text) {
                card.header.text = card.header.text.replace(/{{\d+}}/g, () => `{{${globalIndex++}}}`);
            }
            if (card.body) {
                card.body = card.body.replace(/{{\d+}}/g, () => `{{${globalIndex++}}}`);
            }
            if (Array.isArray(card.buttons)) {
                card.buttons.forEach((btn) => {
                    if (btn.type === "URL" && btn.url) {
                        btn.url = btn.url.replace(/{{\d+}}/g, () => `{{${globalIndex++}}}`);
                    }
                });
            }
        });
    }

    const totalVariables = globalIndex - 1;
    this.variablesCount = totalVariables;
    next();
});

export default mongoose.model("Msg91Template", templateSchema);