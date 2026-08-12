import express from "express";
import {
    googleConnect,
    googleCallback,
    googleDisconnect,
    sendTestEmail,
    googleapkCallback,
} from "../../../controllers/Campaign/EmailConnectors/GoogleauthEmailcontroller.js";
import {
    microsoftConnect,
    microsoftCallback,
    microsoftDisconnect,
} from "../../../controllers/Campaign/EmailConnectors/Microsoftauthcontroller.js";
import { 
    getConnectedAccounts,
    updateEmailDailyLimit,
    getEmailUtilizationHistory
} from "../../../controllers/Campaign/EmailConnectors/Emailstatuscontroller.js";
import { isAuthenticated } from "../../../middleware/authMiddleware.js"; // your existing JWT middleware
import { restrictGuestAccess } from "../../../middleware/restrictGuestAccess.js";

import { connectCustomEmail, disconnectCustomEmail } from "../../../controllers/Campaign/EmailConnectors/CustomEmailController.js";

const EmailConnectorRouter = express.Router();

// ─── Google ───────────────────────────────────────────────────────────────────
// Kick off Google OAuth (user must be logged in)
EmailConnectorRouter.get("/google/connect", googleConnect);

// Google redirects here after consent (no auth middleware — Google calls this directly)
EmailConnectorRouter.get("/google/callback", googleCallback);
EmailConnectorRouter.get("/google/apk/callback", googleapkCallback);

// Disconnect Google
EmailConnectorRouter.delete("/google/disconnect", isAuthenticated, restrictGuestAccess, googleDisconnect);

// ─── Microsoft ────────────────────────────────────────────────────────────────
// Kick off Microsoft OAuth
EmailConnectorRouter.get("/microsoft/connect", microsoftConnect);

// Microsoft redirects here after consent
EmailConnectorRouter.get("/microsoft/callback", microsoftCallback);

// Disconnect Microsoft
EmailConnectorRouter.delete("/microsoft/disconnect", isAuthenticated, restrictGuestAccess, microsoftDisconnect);

// ─── Custom (IMAP/SMTP) ───────────────────────────────────────────────────────

// Connect Custom
EmailConnectorRouter.post("/custom/connect", isAuthenticated, restrictGuestAccess, connectCustomEmail);

// Disconnect Custom
EmailConnectorRouter.delete("/custom/disconnect", isAuthenticated, restrictGuestAccess, disconnectCustomEmail);

// ─── Limits & Utilization ──────────────────────────────────────────────────────
EmailConnectorRouter.put("/limit", isAuthenticated, restrictGuestAccess, updateEmailDailyLimit);
EmailConnectorRouter.get("/utilization", isAuthenticated, getEmailUtilizationHistory);

// ─── Status ───────────────────────────────────────────────────────────────────
// Check which accounts are connected for the logged-in user
EmailConnectorRouter.get("/status", isAuthenticated, getConnectedAccounts);

// ─── Test Email ───────────────────────────────────────────────────────────────
EmailConnectorRouter.post("/test-email", isAuthenticated, restrictGuestAccess, sendTestEmail);

export default EmailConnectorRouter;