import { body, param, query } from "express-validator";
import { validationResult } from "express-validator";

// ─── REUSABLE VALIDATION HANDLER ─────────────────────────────────────────────
export const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            success: false,
            message: "Validation failed",
            errors: errors.array().map((e) => ({
                field: e.path,
                message: e.msg
            }))
        });
    }
    next();
};

// ─── CREATE TEMPLATE VALIDATION ───────────────────────────
export const validateCreateTemplate = [

    body("name")
        .trim()
        .notEmpty().withMessage("Template name is required")
        .isLength({ max: 512 }).withMessage("Name cannot exceed 512 characters"),

    body("category")
        .notEmpty()
        .withMessage("Category is required")
        .isIn(["Marketing", "Utility", "Authentication"])
        .withMessage("Invalid category"),

    body("languages")
        .isArray({ min: 1 })
        .withMessage("At least one language is required"),

    body("languages.*")
        .isString()
        .isLength({ min: 2, max: 10 })
        .withMessage("Invalid language code"),

    body("body")
        .trim()
        .notEmpty()
        .withMessage("Body is required")
        .isLength({ max: 1024 })
        .withMessage("Body cannot exceed 1024 characters"),

    body("footer")
        .optional()
        .isString()
        .isLength({ max: 60 })
        .withMessage("Footer cannot exceed 60 characters"),

    body("ttl")
        .optional({ values: "falsy" })
        .isInt({ min: 0 })
        .withMessage("TTL must be a positive number"),

    // Header
    body("header")
        .optional()
        .isIn(["None", "Text", "Image", "Video", "Document", "Location"])
        .withMessage("Invalid header type"),

    body("headerText")
        .if(body("header").equals("Text"))
        .notEmpty()
        .withMessage("Header text is required when header is Text")
        .isLength({ max: 60 })
        .withMessage("Header text cannot exceed 60 characters"),

    // Buttons
    body("buttons")
        .optional()
        .isArray({ max: 10 })
        .withMessage("Maximum 10 buttons allowed"),

    body("buttons.*.type")
        .optional()
        .isIn(["QUICK_REPLY", "URL", "PHONE_NUMBER", "Custom", "None", "OTP", "FLOW", "CATALOG", "MPM", "COPY_CODE", "VOICE_CALL"])
        .withMessage("Invalid button type"),

    body("buttons.*.text")
        .optional()
        .isLength({ max: 25 })
        .withMessage("Button text cannot exceed 25 characters"),

    body("buttons.*.url")
        .optional()
        .isURL({ protocols: ["http", "https"] })
        .withMessage("Invalid URL"),

    body("buttons.*.phoneNumber")
        .optional()
        .matches(/^\+?[1-9]\d{6,14}$/)
        .withMessage("Invalid phone number format"),

    // Carousel
    body("carouselCards")
        .optional()
        .isArray()
        .withMessage("Carousel cards must be an array"),

    body("carouselCards.*.id")
        .optional()
        .isNumeric()
        .withMessage("Carousel card id must be numeric"),

    body("carouselCards.*.body")
        .optional()
        .isString()
        .withMessage("Card body must be a string")
        .isLength({ max: 160 })
        .withMessage("Card body cannot exceed 160 characters"),

    body("carouselCards.*.headerHandle")
        .optional()
        .isString()
        .withMessage("Header handle must be a string"),

    body("carouselCards.*.buttons")
        .optional()
        .isArray({ max: 2 })
        .withMessage("Carousel cards can have at most 2 buttons"),

    body("carouselCards.*.buttons.*.type")
        .optional()
        .isString(),

    body("carouselCards.*.buttons.*.text")
        .optional()
        .isString()
        .isLength({ max: 25 })
        .withMessage("Button text cannot exceed 25 characters"),

    body("carouselCards.*.buttons.*.url")
        .optional()
        .isURL({ protocols: ["http", "https"] })
        .withMessage("Invalid URL in carousel card button"),

    body("carouselCards.*.buttons.*.phoneNumber")
        .optional()
        .matches(/^\+?[1-9]\d{6,14}$/)
        .withMessage("Invalid phone number in carousel card button"),

    // Numbers
    body("integratedNumber")
        .notEmpty()
        .withMessage("Integrated number is required")
        .isString(),

    body("wabaNumber")
        .notEmpty()
        .withMessage("WABA number is required")
        .isString(),

    validate
];

// ─── GET TEMPLATES ────────────────────────────────────────────────────────────
export const validateGetTemplates = [
    query("status")
        .optional()
        .isIn(["DRAFT", "SUBMITTED", "PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"])
        .withMessage("Invalid status filter"),

    query("page")
        .optional()
        .isInt({ min: 1 }).withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),

    validate
];

// ─── PARAM VALIDATION ─────────────────────────────────────────────────────────
export const validateTemplateId = [
    param("id")
        .isMongoId().withMessage("Invalid template ID"),

    validate
];

// ─── SYNC FROM META ───────────────────────────────────────────────────────────
export const validateSyncTemplate = [
    param("id")
        .isMongoId().withMessage("Invalid template ID"),

    validate
];