import express from "express";

import {
    getContactLists,
    getContactListById,
    createContactList,
    deleteContactList,
    addContactsToList,
    removeContactsFromList
} from "../controllers/metaWhatsappContact.controller.js";

import {
    validateGetContactLists,
    validateCreateContactList,
    validateContactListId,
    validateAddContactsToList,
    validateRemoveContactsFromList
} from "../services/metaWhatsappContact.validator.js";

import { isAuthenticated } from "../../middleware/authMiddleware.js";

const metaWhatsappContactListRouter = express.Router();

// ── Authentication ───────────────────────────────────────────
metaWhatsappContactListRouter.use(isAuthenticated);

// ── Collection routes ─────────────────────────────────────────
metaWhatsappContactListRouter
    .route("/")
    .get(validateGetContactLists,  getContactLists)
    .post(validateCreateContactList, createContactList);

// ── Single list routes ────────────────────────────────────────
metaWhatsappContactListRouter
    .route("/:id")
    .get(validateContactListId, getContactListById)
    .delete(validateContactListId, deleteContactList);

// ── Contact operations inside list ────────────────────────────
metaWhatsappContactListRouter.post(
    "/:id/contacts/add",
    validateAddContactsToList,
    addContactsToList
);

metaWhatsappContactListRouter.post(
    "/:id/contacts/remove",
    validateRemoveContactsFromList,
    removeContactsFromList
);

export default metaWhatsappContactListRouter;