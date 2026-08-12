import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import Supplier from "../../models/googlemap/Supplier.js";
import mongoose from "mongoose";
import logger from "../../config/logger.js";
import socketService from "../../socket.js";

import {
    trackAndDeductFeatureCredit,
    checkBulkFeatureCapacity,
} from "../../utils/creditTracker.js";

import { fetchLeadsWithGemini } from '../../utils/geminiLeadEngine.js';
import { setGoogleLeadsApiProgress } from "../../utils/scraperProgress.js";
import { supplierWhatsAppQueue } from "../index.js";

/**
 * ✅ Direct socket emitter (NO Redis pub/sub)
 */
function emitToUser(userId, event, data) {
    socketService.emitToUser(userId, event, data);
}

/**
 * ✅ Helper: emit + persist progress
 */
export async function emitProgress(userId, event, data = {}) {
    emitToUser(userId, event, data);

    await setGoogleLeadsApiProgress({
        userId,
        event,
        data,
    });
}

new Worker(
    "google-api-lead-generation-queue",
    async (job) => {
        const {
            targetMarket,
            geographicFocus,
            numberOfLeads,
            radius = null,
            userId,
        } = job.data;

        const jobId = job.id;
        const startedAt = Date.now();

        logger.info("[LEAD WORKER] ▶ JOB STARTED", {
            jobId,
            targetMarket,
            geographicFocus,
            numberOfLeads,
            userId,
        });

        try {
            // ─────────────────────────────────────────────
            // CREDIT CHECK
            // ─────────────────────────────────────────────
            const leadsCheck = await checkBulkFeatureCapacity({
                userId,
                featureKey: "leads",
                requiredCount: numberOfLeads,
            });

            if (!leadsCheck.canAfford) {
                throw new Error(leadsCheck.message);
            }

            // ─────────────────────────────────────────────
            // STARTED
            // ─────────────────────────────────────────────
            await emitProgress(userId, "lead:started", {
                jobId,
                targetMarket,
                geographicFocus,
                numberOfLeads,
                percent: 5,
                label: "Starting lead generation…",
            });

            // ─────────────────────────────────────────────
            // EXISTING IDS
            // ─────────────────────────────────────────────
            await emitProgress(userId, "lead:progress", {
                percent: 15,
                label: "Checking existing leads…",
            });

            const existingLeads = await Supplier.find(
                { userId },
                { name: 1, phone: 1, placeId: 1 }
            ).lean();

            const existingPlaceIds = new Set();
            const existingNames = new Set();
            const existingPhones = new Set();

            existingLeads.forEach(lead => {
                if (lead.placeId) {
                    existingPlaceIds.add(String(lead.placeId));
                }
                if (lead.name) {
                    existingNames.add(lead.name.toLowerCase().trim());
                }
                if (lead.phone && lead.phone !== 'N/A') {
                    existingPhones.add(lead.phone.replace(/\D/g, ''));
                }
            });

            logger.info("[LEAD WORKER] Existing check", {
                existingPlaceIds: existingPlaceIds.size,
                existingNames: existingNames.size,
                existingPhones: existingPhones.size,
            });

            // ─────────────────────────────────────────────
            // FETCH FROM GOOGLE
            // ─────────────────────────────────────────────
            const finalDocs = [];
            let attempt = 0;
            const maxAttempts = 15;
            let emptyAttempts = 0;

            while (finalDocs.length < numberOfLeads && attempt < maxAttempts) {
                attempt++;
                const needed = numberOfLeads - finalDocs.length;

                logger.info(`[LEAD WORKER] Attempt ${attempt} — need ${needed} more leads`);

                await emitProgress(userId, "lead:progress", {
                    percent: Math.min(99, 25 + attempt * 5),
                    label: attempt === 1
                        ? "Generating Leads…"
                        : `Fetching ${needed} more leads (attempt ${attempt})…`,
                });

                const buffer = Math.min(needed + 20, needed * 1.2); // max 20% extra, minimum +20
                const leads = await fetchLeadsWithGemini(
                    targetMarket,
                    geographicFocus,
                    Math.ceil(buffer),
                    radius
                );

                if (leads.length === 0) {
                    emptyAttempts++;
                    if (emptyAttempts >= 2) {
                        logger.info(`[LEAD WORKER] Breaking early because Gemini returned 0 leads twice in a row.`);
                        break;
                    }
                } else {
                    emptyAttempts = 0;
                }

                for (const l of leads) {
                    if (finalDocs.length >= numberOfLeads) break;
                    if (!l.placeId) continue;

                    const nameKey = l.name.toLowerCase().trim();
                    const phoneKey = l.phone && l.phone !== 'N/A'
                        ? l.phone.replace(/\D/g, '')
                        : null;

                    if (existingPlaceIds.has(l.placeId)) continue;
                    if (existingNames.has(nameKey)) continue;
                    if (phoneKey && existingPhones.has(phoneKey)) continue;

                    existingPlaceIds.add(l.placeId);
                    existingNames.add(nameKey);
                    if (phoneKey) existingPhones.add(phoneKey);

                    finalDocs.push({
                        ...l,
                        userId,
                        location: { type: 'Point', coordinates: [0, 0] },
                    });
                }
            }

            await emitProgress(userId, "lead:progress", {
                percent: 60,
                label: `Found ${finalDocs.length} leads`,
            });

            const docs = finalDocs;

            let needsExpansion = false;
            let missingCount = numberOfLeads - docs.length;
            if (missingCount > 0 && !radius) {
                needsExpansion = true;
                logger.info(`[LEAD WORKER] Needs radius expansion for ${missingCount} leads.`);
            }

            logger.info("[LEAD WORKER] After filtering", {
                requested: numberOfLeads,
                filteredDocs: docs.length,
                attempts: attempt,
                needsExpansion,
            });
            // ─────────────────────────────────────────────
            // CREDIT DEDUCTION & SAVING
            // ─────────────────────────────────────────────
            await emitProgress(userId, "lead:saving", {
                percent: 80,
                label: "Deducting credits and saving leads…",
            });

            let successfulLeads = [];
            let freeRemainingToUse = leadsCheck.freeRemaining;
            
            for (const lead of docs) {
                try {
                    const isFree = freeRemainingToUse > 0;
                    if (isFree) freeRemainingToUse--;

                    // 1. Deduct Credit FIRST (1-by-1 handles free-then-wallet automatically)
                    await trackAndDeductFeatureCredit({
                        userId,
                        featureKey: "leads",
                        usageCount: 1,
                        description: `Lead Generated ${isFree ? "(Free Usage) " : "(Wallet Usage)"} - ${lead.name}`,
                        idempotencyKey: `lead-${userId}-${lead.placeId}-${jobId}`,
                    });
                    
                    // 2. Only if successful, queue for saving
                    successfulLeads.push(lead);
                } catch (err) {
                    logger.warn("[LEAD WORKER] Credit deduction failed (likely out of credits), stopping further processing.", {
                        error: err.message,
                        leadName: lead.name
                    });
                    // Stop processing further leads if they ran out of credits mid-job
                    break;
                }
            }

            let inserted = 0;

            if (successfulLeads.length > 0) {
                try {
                    const insertedSuppliers = await Supplier.insertMany(successfulLeads, { ordered: false });
                    inserted = successfulLeads.length;
                    
                    if (insertedSuppliers?.length) {
                        const jobs = insertedSuppliers.map((supplier) => ({
                            name: "check-whatsapp-number",
                            data: {
                                supplierId: supplier._id,
                                userId: userId,
                            },
                        }));

                        await supplierWhatsAppQueue.addBulk(jobs);
                    }
                } catch (err) {
                    if (err.writeErrors) {
                        inserted = successfulLeads.length - err.writeErrors.length;
                    } else {
                        throw err;
                    }
                }
            }

            // ─────────────────────────────────────────────
            // STATS
            // ─────────────────────────────────────────────
            const totalInDb = await Supplier.countDocuments({ userId });

            const stats = await Supplier.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: null,
                        avgRating: { $avg: "$rating" },
                        totalWithEmails: {
                            $sum: {
                                $cond: [
                                    { $gt: [{ $size: { $ifNull: ["$emails", []] } }, 0] },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
            ]);

            // ─────────────────────────────────────────────
            // COMPLETED
            // ─────────────────────────────────────────────
            if (needsExpansion) {
                await emitProgress(userId, "lead:needs_expansion", {
                    percent: 100,
                    inserted,
                    totalInDb,
                    foundCount: docs.length,
                    neededCount: missingCount,
                    targetMarket,
                    geographicFocus,
                    numberOfLeads,
                    label: `Found ${inserted} leads. Need radius expansion.`,
                });
                return {
                    success: true,
                    message: `Found ${inserted} leads. Prompting for radius expansion.`,
                }
            } else {
                await emitProgress(userId, "lead:completed", {
                    percent: 100,
                    inserted,
                    totalInDb,
                    avg_rating: stats[0]?.avgRating?.toFixed(1) || "0.0",
                    leads_with_emails: stats[0]?.totalWithEmails || 0,
                    label: `${inserted} leads generated`,
                });

                logger.info("[LEAD WORKER] ✅ DONE", {
                    jobId,
                    inserted,
                    time: ((Date.now() - startedAt) / 1000).toFixed(2) + "s",
                });

                return {
                    success: true,
                    message: `${inserted} Lead generation completed.`,
                }
            }
        } catch (error) {
            logger.error("[LEAD WORKER] ❌ FAILED", {
                jobId,
                error: error.message,
            });

            await emitProgress(userId, "lead:failed", {
                percent: 0,
                label: "Lead generation failed",
                error: error.message,
            });

            return {
                success: false,
                message: 'Lead generation failed.',
            }
        }
    },
    {
        connection: redisClient,
        concurrency: 10,
    }
);