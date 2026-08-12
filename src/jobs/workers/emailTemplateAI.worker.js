import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import socketService from "../../socket.js";
import AIEmailTemplate from "../../models/Campaign/EmailCampaign/aiTemplateSchema.js";
import EmailTemplate from "../../models/Campaign/EmailCampaign/templateSchema.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import { generateEmailTemplateWithAI } from "../../services/emailTemplateAI.service.js";
import { extractVariables } from "../../services/template.service.js";
import { trackAndDeductFeatureCredit } from "../../utils/creditTracker.js";
import { FreeUsage, FreeUsageMaster } from "../../models/credits/index.js";

/* ─── Socket helper ─── */
function emitToUser(userId, event, data) {
  socketService.emitToUser(userId, event, data);
}

/* ─────────────────────────────────────────────────────────────
   EMAIL TEMPLATE AI WORKER
   Production flow:
     1. Pre-check  → FreeUsageMaster limit gate (no expensive work yet)
     2. Notify     → Inform client generation has started
     3. Fetch      → Business profile context
     4. Generate   → AI template via Claude
     5. Save       → Persist to DB
     6. Deduct     → Credit / free usage AFTER successful save
     7. Complete   → Emit result to client
   ───────────────────────────────────────────────────────────── */
new Worker(
  "email-template-ai-queue",
  async (job) => {
    const {
      userId,
      prompt,
      targetUserId, // admin: whose business data to use (null = admin's own)
      saveAs, // "ai_template" (admin global) | "user_template" (user's own)
      dataType, // "dummy" (placeholder data) | "analysis" (real business profile)
      category,
      isFeatured,
      tags,
      sourceAITemplateId,
      jobId,
    } = job.data;

    let savedTemplate = null; // tracked for rollback

    try {
      /* ── STEP 1: FreeUsageMaster pre-check ──────────────────────────
               Read the admin-configured limit for emailTemplate.
               Block immediately — before any AI call — if quota is exhausted.
            ─────────────────────────────────────────────────────────────── */
      const masterConfig = await FreeUsageMaster.findOne({
        featureKey: "aiEmailTemplateGen",
        isActive: true,
      }).lean();

      if (masterConfig) {
        const freeUsageDoc = await FreeUsage.findOne({ userId }).lean();
        const used = freeUsageDoc?.usage?.emailTemplate?.used ?? 0;
        const limit = masterConfig.limit ?? 0;

        logger.info(
          `[EmailTemplateAI] user=${userId} | freeUsed=${used}/${limit}`,
        );

        // limit === -1 means unlimited; 0 means feature is disabled
        if (limit === 0) {
          throw Object.assign(
            new Error(
              "AI email template generation is not available on your current plan. Please upgrade.",
            ),
            { status: 403, insufficientCredits: true },
          );
        }

        if (limit !== -1 && used >= limit) {
          throw Object.assign(
            new Error(
              `You have used all ${limit} free AI email template generation(s). Please upgrade your plan.`,
            ),
            { status: 403, insufficientCredits: true },
          );
        }
      }

      /* ── STEP 2: Notify client — generation starting ────────────── */
      emitToUser(userId, "email-template:generating", {
        jobId,
        status: "generating",
        message: "Fetching business data...",
        progress: 10,
      });

      /* ── STEP 3: Fetch business profile ─────────────────────────── */
      const profileUserId = targetUserId || userId;
      let businessProfile = null;

      // Admin can choose: 'dummy' → placeholder data, 'analysis' → real business profile
      const useDummyData =
        dataType === "dummy" || (!dataType && saveAs === "ai_template");

      if (useDummyData) {
        businessProfile = {
          analysis: {
            business_overview: {
              brand_name: "Demo Company",
              core_value_proposition: "Providing excellent services",
            },
            branding_guidelines: {
              brand_colors: ["#000000", "#FFFFFF"],
              fonts: ["Arial"],
              visual_style: "Modern",
            },
            contact_info: { website: "https://example.com" },
          },
          analysisSummary: "This is a demo company for template generation.",
        };
      } else {
        businessProfile = await BusinessSummaryProfile.findOne({
          userId: profileUserId,
          status: "COMPLETED",
          isActive: true,
        }).lean();

        if (!businessProfile) {
          // Fallback: generate with prompt only (no business context)
          businessProfile = { analysis: {}, analysisSummary: "" };
        }
      }

      emitToUser(userId, "email-template:generating", {
        jobId,
        status: "generating",
        message: "Generating template with AI...",
        progress: 30,
      });

      /* ── STEP 4: AI generation ───────────────────────────────────── */
      const generated = await generateEmailTemplateWithAI({
        prompt,
        businessProfile,
        userId,
        saveAs,
      });

      emitToUser(userId, "email-template:generating", {
        jobId,
        status: "generating",
        message: "Saving template...",
        progress: 75,
      });

      /* ── STEP 5: Extract variables ──────────────────────────────── */
      const variables = extractVariables(generated.html);

      /* ── STEP 6: Save to DB ─────────────────────────────────────── */
      const designValue = generated.design
        ? typeof generated.design === "string"
          ? generated.design
          : JSON.stringify(generated.design)
        : null;

      if (saveAs === "ai_template") {
        /* Admin: save as global AI template library */
        savedTemplate = await AIEmailTemplate.create({
          name: generated.name,
          subject: generated.subject,
          html: generated.html,
          design: designValue,
          prompt,
          category: category || "General",
          description: generated.description || "",
          variables,
          tags: Array.isArray(tags) ? tags : [],
          isFeatured: !!isFeatured,
          createdBy: userId,
        });
      } else {
        /* User: save to personal template library with unique name */
        const baseName = generated.name;
        const existingCount = await EmailTemplate.countDocuments({
          userId,
          name: { $regex: `^${baseName}`, $options: "i" },
          isActive: true,
        });
        const finalName =
          existingCount > 0 ? `${baseName} (${existingCount})` : baseName;

        savedTemplate = await EmailTemplate.create({
          userId,
          name: finalName,
          subject: generated.subject,
          html: generated.html,
          design: designValue,
          variables,
          attachments: [],
          createdBy: userId,
          sourcePrompt: prompt,
          isAIGenerated: true,
          sourceAITemplate:
            sourceAITemplateId ||
            (targetUserId ? null : generated.sourceAITemplateId || null),
        });
      }

      /* ── STEP 7: Deduct credit / free usage AFTER successful save ──
               Only charge when we have actually delivered the template.
               If deduction fails → roll back the saved template.
            ─────────────────────────────────────────────────────────────── */
      try {
        await trackAndDeductFeatureCredit({
          userId,
          featureKey: "emailTemplateAiGeneration",
          usageCount: 1,
          referenceId: savedTemplate._id.toString(),
          referenceModel:
            saveAs === "ai_template"
              ? "emailTemplateAiGeneration"
              : "emailTemplateAiGeneration",
          description: `AI Email Template generated: "${savedTemplate.name}"`,
          metadata: {
            title: savedTemplate.name,
            prompt,
            extra: { saveAs },
          },
        });
      } catch (deductErr) {
        /* Deduction failed — roll back the saved template so the user
                   is not left with a template they were never charged for,
                   and we don't silently lose the deduction. */
        logger.error(
          `[EmailTemplateAI] Deduction failed for user ${userId}, rolling back template ${savedTemplate._id}: ${deductErr.message}`,
        );

        const Model =
          saveAs === "ai_template" ? AIEmailTemplate : EmailTemplate;
        await Model.findByIdAndDelete(savedTemplate._id).catch((rbErr) =>
          logger.error(`[EmailTemplateAI] Rollback failed: ${rbErr.message}`),
        );

        throw Object.assign(
          new Error(
            "Template was generated but credit deduction failed. Please try again.",
          ),
          { status: 402 },
        );
      }

      /* ── STEP 8: Emit completion ────────────────────────────────── */
      emitToUser(userId, "email-template:completed", {
        jobId,
        status: "completed",
        message: "Template generated successfully!",
        progress: 100,
        template: savedTemplate,
        saveAs,
      });

      logger.info(
        `✅ [EmailTemplateAI] Template "${savedTemplate.name}" saved & charged for user ${userId}`,
      );

      return savedTemplate._id;
    } catch (error) {
      console.log("error", error);
      logger.error(
        `❌ [EmailTemplateAI] Failed for user ${userId}: ${error.message}`,
      );

      emitToUser(userId, "email-template:failed", {
        jobId,
        status: "failed",
        message:
          error.message || "Template generation failed. Please try again.",
        progress: 0,
        insufficientCredits: !!error.insufficientCredits,
      });

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 3,
  },
);

logger.info("📧 Email Template AI Worker started");
