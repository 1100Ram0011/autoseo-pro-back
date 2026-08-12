import { body, param, query, validationResult } from "express-validator";

// ─────────────────────────────────────────────────────────────
// Common validation middleware
// ─────────────────────────────────────────────────────────────
const handleValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

// ─────────────────────────────────────────────────────────────
// Get contacts
// ─────────────────────────────────────────────────────────────
export const validateGetContacts = [
    query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive number"),
    query("limit").optional().isInt({ min: 1 }).withMessage("limit must be a positive number"),
    query("search").optional().isString(),
    query("tag").optional().isString(),
    query("optedOut").optional().isBoolean().withMessage("optedOut must be true or false"),
    handleValidation
];

// ─────────────────────────────────────────────────────────────
// Create contact
// ─────────────────────────────────────────────────────────────
export const validateCreateContact = [
    body("phone")
        .notEmpty()
        .withMessage("phone is required")
        .isString()
        .withMessage("phone must be a string"),

    body("name").optional().isString(),
    body("email").optional().isEmail().withMessage("invalid email"),
    body("tags").optional().isArray().withMessage("tags must be an array"),
    body("customFields").optional().isObject().withMessage("customFields must be an object"),

    handleValidation
];

// ─────────────────────────────────────────────────────────────
// Validate contact id
// ─────────────────────────────────────────────────────────────
export const validateContactId = [
    param("id").isMongoId().withMessage("invalid contact id"),
    handleValidation
];

// ─────────────────────────────────────────────────────────────
// Update contact
// ─────────────────────────────────────────────────────────────
export const validateUpdateContact = [
    param("id").isMongoId().withMessage("invalid contact id"),

    body("name").optional().isString(),
    body("email").optional().isEmail().withMessage("invalid email"),
    body("tags").optional().isArray(),
    body("customFields").optional().isObject(),
    body("optedOut").optional().isBoolean(),

    handleValidation
];

// ─────────────────────────────────────────────────────────────
// Bulk import contacts
// ─────────────────────────────────────────────────────────────
export const validateBulkImportContacts = [
    body("contacts")
        .isArray({ min: 1 })
        .withMessage("contacts must be a non-empty array"),

    body("contacts.*.phone")
        .notEmpty()
        .withMessage("phone is required for each contact"),

    body("contacts.*.name").optional().isString(),
    body("contacts.*.email").optional().isEmail(),
    body("contacts.*.tags").optional().isArray(),
    body("contacts.*.customFields").optional().isObject(),

    handleValidation
];

// ─────────────────────────────────────────────
// Get lists
// ─────────────────────────────────────────────
export const validateGetContactLists = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1 }),
    handleValidation
];

// ─────────────────────────────────────────────
// Create list
// ─────────────────────────────────────────────
export const validateCreateContactList = [
    body("name")
        .notEmpty()
        .withMessage("List name is required")
        .isString(),

    body("description").optional().isString(),

    body("contactIds")
        .optional()
        .isArray()
        .withMessage("contactIds must be an array"),

    handleValidation
];

// ─────────────────────────────────────────────
// Validate list id
// ─────────────────────────────────────────────
export const validateContactListId = [
    param("id").isMongoId().withMessage("Invalid list id"),
    handleValidation
];

// ─────────────────────────────────────────────
// Add contacts to list
// ─────────────────────────────────────────────
export const validateAddContactsToList = [
    param("id").isMongoId().withMessage("Invalid list id"),

    body("contactIds")
        .isArray({ min: 1 })
        .withMessage("contactIds must be a non empty array"),

    body("contactIds.*")
        .isMongoId()
        .withMessage("Each contactId must be a valid MongoId"),

    handleValidation
];

// ─────────────────────────────────────────────
// Remove contacts from list
// ─────────────────────────────────────────────
export const validateRemoveContactsFromList = [
    param("id").isMongoId().withMessage("Invalid list id"),

    body("contactIds")
        .isArray({ min: 1 })
        .withMessage("contactIds must be a non empty array"),

    body("contactIds.*")
        .isMongoId()
        .withMessage("Each contactId must be a valid MongoId"),

    handleValidation
];