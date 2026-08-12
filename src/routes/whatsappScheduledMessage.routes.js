import express from "express";

import {
  sendNow,
  createSchedule,
  getSchedules,
  getScheduleById,
  pauseSchedule,
  resumeSchedule,
  deleteSchedule,
  runNowSchedule,
} from "../controllers/whatsappScheduledMessage.controller.js";

import {
  isAuthenticated,
} from "../middleware/authMiddleware.js";

const router =
  express.Router();

router.use(
  isAuthenticated
);

router.post(
  "/send",
  sendNow
);

router.post(
  "/schedule",
  createSchedule
);

router.get(
  "/schedule",
  getSchedules
);

router.get(
  "/schedule/:scheduleId",
  getScheduleById
);

router.post(
  "/schedule/:scheduleId/pause",
  pauseSchedule
);

router.post(
  "/schedule/:scheduleId/resume",
  resumeSchedule
);

router.delete(
  "/schedule/:scheduleId",
  deleteSchedule
);

router.post(
  "/schedule/:scheduleId/run-now",
  runNowSchedule
);

export default router;