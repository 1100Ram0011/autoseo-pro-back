// individualAnalysis.worker.js

// queue/workers/individualAnalysis.worker.js
// Uses setIndividualProgress (Redis) at every stage — same pattern as firecrawl worker

import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import IndividualAnalysisProfile from "../../models/IndividualAnalysisProfile.js";
import { runIndividualBrandAnalysis } from "../../services/Individual/Individualanalysis.service.js";
import {
    setIndividualProgress,
} from "../../utils/analysisProgress.js";
import logger from "../../config/logger.js";
import { trackAndDeductFeatureCredit, checkBulkFeatureCapacity } from "../../utils/creditTracker.js";
import userModel from "../../models/userModel.js";

// ─── Redis publisher (duplicate — required by ioredis) ────────────────────────
const publisher = redisClient.duplicate();

// ─── Emit socket event to a user via Redis pub/sub ────────────────────────────
async function emitToUser(userId, event, data) {
    const payload = JSON.stringify({
        userId: userId.toString(),
        event,
        data,
    });
    await publisher.publish("socket:user", payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────────────────────
new Worker(
    "individual-analysis-queue",

    async (job) => {
        const { userId, profileId } = job.data;

        logger.info("[IndividualAnalysis Worker] Job started", {
            jobId: job.id,
            userId,
            profileId,
        });

        // ── 1. Load profile ──────────────────────────────────────────────────
        const profile = await IndividualAnalysisProfile.findById(profileId).lean();

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        // ── 2. PROCESSING — Redis + DB + socket ──────────────────────────────
        await setIndividualProgress({
            userId,
            profileId,
            stage: "PROCESSING",
        });

        await IndividualAnalysisProfile.findByIdAndUpdate(profileId, {
            $set: {
                analysisStatus: "processing",
                analysisError: null,
                analysisResult: null,
                growthScorecard: null,
                confidenceLevels: null,
                analysisCompletedAt: null,
            },
        });

        await emitToUser(userId, "individual:analysis:processing", {
            profileId,
            stage: "processing",
            percent: 40,
            message: "AI is building your brand report…",
        });

        logger.info("[IndividualAnalysis Worker] Claude analysis started", {
            userId,
            profileId,
        });

        // ── 2a. Pre-check Credits — safety ───────────────────────────────────
        const creditCheck = await checkBulkFeatureCapacity({
            userId,
            featureKey: "individualAnalysis",
            requiredCount: 1,
        });

        if (!creditCheck.canAfford) {
            throw new Error(creditCheck.message || "Insufficient credits for individual analysis.");
        }

        // ── 3. Run Claude ────────────────────────────────────────────────────
        let analysisResult;
        try {
            analysisResult = await runIndividualBrandAnalysis({
                description: profile.description,
                photoUrl: profile.photoUrl,
                logoUrl: profile.logoUrl,
                socialMediaLinks: profile.socialMediaLinks,
            });
        } catch (claudeErr) {
            // write failure to Redis before re-throwing so BullMQ retry logic kicks in
            await setIndividualProgress({
                userId,
                profileId,
                stage: "FAILED",
                error: claudeErr.message,
            });

            await emitToUser(userId, "individual:analysis:failed", {
                profileId,
                stage: "failed",
                percent: -1,
                message: claudeErr.message || "AI analysis failed",
            });

            throw claudeErr;
        }

        // ── 3a. Success — Deduct Credits ─────────────────────────────────────
        try {
            await trackAndDeductFeatureCredit({
                userId,
                featureKey: "individualAnalysis",
                usageCount: 1,
                referenceId: profileId,
                referenceModel: "IndividualAnalysisProfile",
                description: "AI Personal Brand Analysis — Generated Brand Report",
                idempotencyKey: `individual-analysis-deduction-${profileId}`,
                metadata: {
                    title: "Individual Brand Analysis",
                    extra: { profileId, jobId: job.id }
                }
            });

            logger.info("[IndividualAnalysis Worker] Credits deducted successfully", { userId, profileId });
        } catch (creditErr) {
            logger.error("[IndividualAnalysis Worker] Credit deduction failed after AI run", { userId, profileId, error: creditErr.message });
        }

        // ── 4. Inject real S3 URLs ───────────────────────────────────────────
        if (analysisResult?.image_content) {
            analysisResult.image_content.photo_url = profile.photoUrl ?? "";
            analysisResult.image_content.logo_url = profile.logoUrl ?? "";
        }
        if (analysisResult?.contact_and_social) {
            analysisResult.contact_and_social.photo_url = profile.photoUrl ?? "";
            analysisResult.contact_and_social.logo_url = profile.logoUrl ?? "";
        }

        // ── 5. COMPLETED — Redis + DB ────────────────────────────────────────
        await setIndividualProgress({
            userId,
            profileId,
            stage: "COMPLETED",
        });

        await IndividualAnalysisProfile.findByIdAndUpdate(profileId, {
            $set: {
                analysisStatus: "completed",
                analysisResult,
                analysisError: null,
                growthScorecard: analysisResult?.growth_scorecard ?? null,
                confidenceLevels: analysisResult?.confidence_levels ?? null,
                analysisCompletedAt: new Date(),
            },
        });

        await userModel.findByIdAndUpdate(userId, { $set: { accountType: "individual" } }, { upsert: true, new: true })

        logger.info("[IndividualAnalysis Worker] Analysis completed", {
            userId,
            profileId,
        });

        // ── 6. Emit completed event with full result payload ─────────────────
        await emitToUser(userId, "individual:analysis:completed", {
            profileId,
            stage: "completed",
            percent: 100,
            message: "Your brand report is ready!",
            data: {
                profileId,
                analysisStatus: "completed",
                analysisCompletedAt: new Date(),
                photoUrl: profile.photoUrl,
                logoUrl: profile.logoUrl ?? null,
                growthScorecard: analysisResult?.growth_scorecard ?? null,
                confidenceLevels: analysisResult?.confidence_levels ?? null,
                analysisResult,
            },
        });

        return { success: true, profileId };
    },

    {
        connection: redisClient,
        concurrency: 2,
    },
)
    .on("completed", (job) => {
        logger.info("[IndividualAnalysis Worker] ✓ Job completed", { jobId: job.id });
    })

    .on("failed", async (job, err) => {
        const { userId, profileId } = job?.data ?? {};

        logger.error("[IndividualAnalysis Worker] ✗ Job failed", {
            jobId: job?.id,
            userId,
            profileId,
            error: err.message,
            attempts: job?.attemptsMade,
        });

        // Only finalize after ALL retries are exhausted
        if (job?.attemptsMade >= (job?.opts?.attempts ?? 1)) {

            // Redis — mark FAILED
            await setIndividualProgress({
                userId,
                profileId,
                stage: "FAILED",
                error: err.message || "Unknown worker error",
            }).catch(() => { });

            // DB — mark failed
            await IndividualAnalysisProfile.findByIdAndUpdate(profileId, {
                $set: {
                    analysisStatus: "failed",
                    analysisError: err.message || "Unknown worker error",
                },
            }).catch(() => { });

            // Socket — notify frontend
            await publisher
                .publish(
                    "socket:user",
                    JSON.stringify({
                        userId: userId?.toString(),
                        event: "individual:analysis:failed",
                        data: {
                            profileId,
                            stage: "failed",
                            percent: -1,
                            message: err.message || "Analysis failed. Please retry.",
                        },
                    }),
                )
                .catch(() => {

                    logger.error("[IndividualAnalysis Worker] x Socket publish failed", {
                        jobId: job?.id,
                        userId,
                        profileId,
                        error: err.message,
                        attempts: job?.attemptsMade,
                    });

                });
        }
    });

