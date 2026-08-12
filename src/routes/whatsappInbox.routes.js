import express from "express";

import {
  getChats,
  getChatMessages,
  getGroups,
  getGroupDetails,
  getGroupMembers,
} from "../controllers/whatsappInbox.controller.js";

import {
  isAuthenticated,
} from "../middleware/authMiddleware.js";

const router =
  express.Router();

router.use(
  isAuthenticated
);

router.get(
  "/chats/:connectionId",
  getChats
);

router.get(
  "/chats/:connectionId/:chatId",
  getChatMessages
);

router.get(
  "/groups/:connectionId",
  getGroups
);

router.get(
  "/groups/:connectionId/:groupId",
  getGroupDetails
);

router.get(
  "/groups/:connectionId/:groupId/members",
  getGroupMembers
);

export default router;