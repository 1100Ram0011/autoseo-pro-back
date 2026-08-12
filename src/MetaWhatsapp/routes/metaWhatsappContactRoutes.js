import express from "express";

import {
    getContacts,
    getContactById,
    createContact,
    updateContact,
    deleteContact,
    bulkImportContacts
} from "../controllers/metaWhatsappContact.controller.js";

import {
    validateGetContacts,
    validateCreateContact,
    validateContactId,
    validateUpdateContact,
    validateBulkImportContacts
} from "../services/metaWhatsappContact.validator.js";

import { isAuthenticated } from "../../middleware/authMiddleware.js";

const metaWhatsappContactRouter = express.Router();

// All contact routes require authentication
metaWhatsappContactRouter.use(isAuthenticated);

// ── Collection routes ──────────────────────────────────────────────────────────
metaWhatsappContactRouter
    .route("/")
    .get(validateGetContacts, getContacts)
    .post(validateCreateContact, createContact);

// ── Bulk Import ───────────────────────────────────────────────────────────────
metaWhatsappContactRouter.post(
    "/bulk-import",
    validateBulkImportContacts,
    bulkImportContacts
);

// ── Single resource routes ─────────────────────────────────────────────────────
metaWhatsappContactRouter
    .route("/:id")
    .get(validateContactId, getContactById)
    .patch(validateUpdateContact, updateContact)
    .delete(validateContactId, deleteContact);
    

export default metaWhatsappContactRouter;