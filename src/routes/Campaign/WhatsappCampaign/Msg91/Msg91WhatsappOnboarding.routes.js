import express from "express";
import {
    submitOnboardingForm,
    confirmFbAdmin,
    submitConnectionRequest,
    cancelOnboardingRequest,
    getMyOnboardingRequests,
    getOnboardingRequestById,
    getAllOnboardingRequests,
    approveConnectionRequest,
    rejectConnectionRequest,
    getWhatsappActivation
} from "../../../../controllers/Campaign/WhatsappCampaign/Msg91/Msg91whatsappOnboarding.controller.js";
import { authorizeRoles, isAuthenticated } from "../../../../middleware/authMiddleware.js";

const Msg91whatsappOnboardingRouter = express.Router();


// ── User routes ───────────────────────────────────────────────────────────────
Msg91whatsappOnboardingRouter.get("/activation", isAuthenticated, getWhatsappActivation);
Msg91whatsappOnboardingRouter.get("/onboarding", isAuthenticated, getMyOnboardingRequests);
Msg91whatsappOnboardingRouter.get("/onboarding/:id", isAuthenticated, getOnboardingRequestById);
Msg91whatsappOnboardingRouter.post("/onboarding", isAuthenticated, submitOnboardingForm);
Msg91whatsappOnboardingRouter.patch("/onboarding/:id/fb-confirm", isAuthenticated, confirmFbAdmin);
Msg91whatsappOnboardingRouter.patch("/onboarding/:id/submit", isAuthenticated, submitConnectionRequest);
Msg91whatsappOnboardingRouter.patch("/onboarding/:id/cancel", isAuthenticated, cancelOnboardingRequest);

// ── Admin routes ──────────────────────────────────────────────────────────────
Msg91whatsappOnboardingRouter.get("/onboarding/admin/all", isAuthenticated, authorizeRoles("admin"), getAllOnboardingRequests);
Msg91whatsappOnboardingRouter.patch("/onboarding/:id/approve", isAuthenticated, authorizeRoles("admin"), approveConnectionRequest);
Msg91whatsappOnboardingRouter.patch("/onboarding/:id/reject", isAuthenticated, authorizeRoles("admin"), rejectConnectionRequest);

export default Msg91whatsappOnboardingRouter;


// POST   /onboarding                  → PENDING       (form submitted)
// PATCH  /onboarding/:id/fb-confirm   → FB_CONFIRMED  (user confirms FB admin added)
// PATCH  /onboarding/:id/submit       → SUBMITTED     (sends to admin queue)
// PATCH  /onboarding/:id/cancel       → CANCELLED     (user cancels anytime before approval)

// PATCH  /onboarding/:id/approve      → APPROVED      (admin — full or partial per number)
// PATCH  /onboarding/:id/reject       → REJECTED      (admin — all numbers rejected)

// GET    /activation                  → active numbers for logged-in user
// GET    /onboarding                  → user's own requests
// GET    /onboarding/admin/all        → all requests (admin, filterable by status)