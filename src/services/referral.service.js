import mongoose from "mongoose";
import SettingValue from "../models/settingValue.model.js";
import ReferralWallet from "../models/ReferralWallet.js";
import FaceSwapRequest from "../models/FaceSwapRequest.js";
import ReferralWalletLedger from "../models/ReferralWalletLedger.js";
import SwapTemplate from "../models/SwapTemplate.js";
import settingValueModel from "../models/settingValue.model.js";
import PixverseprompttemplateModel from "../models/Pixverse/Pixverseprompttemplate.model.js";

export const handleReferralAfterTemplateCreation = async ({
    createdTemplate,
    request,
    templateOwnerId,
    isFaceswap
}) => {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            // 🔒 Prevent duplicate execution
            const freshRequest = await FaceSwapRequest.findById(request._id).session(session);
            // const Pixverse_Face_Swap_Credits_Setting = await settingValueModel.findOne({ key: "Pixverse_Face_Swap_Credits" }).lean();
            // const pixverseCredits = Pixverse_Face_Swap_Credits_Setting?.values

            if (!freshRequest || freshRequest.isCommissionDistributed) {
                console.log("⚠️ Commission already distributed");
                return;
            }

            // ⚙️ Get config
            const setting = await SettingValue.findOne({
                key: "Video_Referral_Distribution",
            }).lean();

            const gstSetting = await SettingValue.findOne({
                key: "gst_config",
            }).lean();

            if (!setting) throw new Error("Distribution setting not found");

            const config = setting.values;
            const gstConfig = gstSetting.values;

            // 🧬 TEMPLATE LINEAGE
            const currentTemplateId = createdTemplate._id;
            const parentTemplateId = createdTemplate.parentTemplateId || null;
            const originTemplateId = createdTemplate.originTemplateId || null;

            // 🔥 Fetch parent + grandparent in minimal queries
            let parentTemplate = null;
            let grandParentTemplate = null;



            if (parentTemplateId) {
                if (isFaceswap) {
                    parentTemplate = await SwapTemplate.findById(parentTemplateId).lean();

                    if (parentTemplate?.parentTemplateId) {
                        grandParentTemplate = await SwapTemplate.findById(
                            parentTemplate.parentTemplateId
                        ).lean();
                    }
                }
                else {
                    parentTemplate = await PixverseprompttemplateModel.findById(parentTemplateId).lean();

                    if (parentTemplate?.parentTemplateId) {
                        grandParentTemplate = await PixverseprompttemplateModel.findById(
                            parentTemplate.parentTemplateId
                        ).lean();
                    }
                }
            }

            const grandParentTemplateId = grandParentTemplate?._id || null;

            // 👤 Resolve users
            let creatorUserId = null;

            if (originTemplateId) {
                if (isFaceswap) {
                    const originTemplate = await SwapTemplate.findById(originTemplateId).lean();
                    creatorUserId = originTemplate?.ownerId || null;
                }
                else {
                    const originTemplate = await PixverseprompttemplateModel.findById(originTemplateId).lean();
                    creatorUserId = originTemplate?.ownerId || null;
                }

            }

            const parentUserId = parentTemplate?.ownerId || null;
            const grandParentUserId = grandParentTemplate?.ownerId || null;

            let distributionType = "single";

            // 👤 userIds
            const cId = creatorUserId?.toString();
            const pId = parentUserId?.toString();
            const gId = grandParentUserId?.toString();

            // 🔥 STEP 1: Handle collisions FIRST
            if (cId && pId && cId === pId) {
                distributionType = "single";
            }
            else if (cId && gId && cId === gId) {
                distributionType = "partial";
            }

            // 🔥 STEP 2: Normal hierarchy
            else if (originTemplateId && parentTemplateId && grandParentTemplateId) {
                distributionType = "full";
            }
            else if (originTemplateId && parentTemplateId) {
                distributionType = "partial";
            }
            else {
                distributionType = "single";
            }
            let basic, gst_amt;
            let totalAmount = config?.cost_per_sec * createdTemplate?.durationSeconds
            if (!gstConfig?.including_gst) {
                basic = totalAmount
                gst_amt = totalAmount * (gstConfig?.gst || 0 / 100);
                totalAmount = totalAmount + gst_amt

            }
            else {
                basic = totalAmount / (1 + (gstConfig?.gst || 0) / 100);
                gst_amt = totalAmount - basic
            }

            let finalAllDistrubutionAmount = (basic * config?.plaform_split) / 100
            // console.log('total distribution amount', totalAmount, finalAllDistrubutionAmount)
            // if (config?.is_include_gst) {
            //     const gstAmount = totalAmount * (config?.gst || 0) / 100;
            //     finalAllDistrubutionAmount = finalAllDistrubutionAmount - gstAmount
            // }

            //  console.log('total gstAmount amount', gstAmount)

            const baseAmount = finalAllDistrubutionAmount;
            // console.log('total gstAmount amount', baseAmount)
            const distribution = config[distributionType];

            if (!distribution) {
                throw new Error(`Invalid distribution config for ${distributionType}`);
            }

            // 💰 Build payouts
            let payouts = [];

            if (distribution.creator && creatorUserId) {
                payouts.push({
                    userId: creatorUserId,
                    role: "creator",
                    percentage: distribution.creator,
                    originTemplateId: originTemplateId,
                });
            }

            if (distribution.parent && parentUserId && parentTemplateId) {
                payouts.push({
                    userId: parentUserId,
                    role: "parent",
                    percentage: distribution.parent,
                    originTemplateId: parentTemplateId,
                });
            }

            if (
                distribution.grandparent &&
                grandParentUserId &&
                grandParentTemplateId
            ) {
                payouts.push({
                    userId: grandParentUserId,
                    role: "grandparent",
                    percentage: distribution.grandparent,
                    originTemplateId: grandParentTemplateId,
                });
            }

            // 🔥 MERGE DUPLICATE USERS (IMPORTANT)
            const mergedPayoutsMap = new Map();

            for (const p of payouts) {
                const key = String(p.userId);

                if (!mergedPayoutsMap.has(key)) {
                    mergedPayoutsMap.set(key, { ...p });
                } else {
                    const existing = mergedPayoutsMap.get(key);

                    existing.percentage += p.percentage;
                    // keep highest priority role (optional)
                    existing.role = existing.role === "creator" ? "creator" : p.role;
                }
            }

            const finalPayouts = Array.from(mergedPayoutsMap.values());

            // 💸 Execute payouts
            for (const p of finalPayouts) {
                const amount = Number((((baseAmount * p.percentage) / 100)).toFixed(0));
                // console.log('Payout:', JSON.stringify(p), 'Amount', amount)
                if (amount <= 0) continue;

                const wallet = await ReferralWallet.findOneAndUpdate(
                    { userId: p.userId },
                    {
                        $inc: {
                            balance: amount,
                            totalEarned: amount,
                        },
                        $set: { lastTransactionAt: new Date() },
                    },
                    {
                        new: true,
                        upsert: true,
                        session,
                    }
                );

                const balanceAfter = wallet.balance;
                const balanceBefore = balanceAfter - amount;

                await ReferralWalletLedger.create(
                    [
                        {
                            userId: p.userId,
                            type: "CREDIT",
                            source: "REFERRAL",
                            amount,
                            balanceBefore,
                            balanceAfter,

                            referral: {
                                sourceUserId: request.userId,

                                templateId: currentTemplateId,
                                templateOwnerId,

                                originTemplateId: p.originTemplateId, // 🔥 CORRECT

                                role: p.role,
                                percentage: p.percentage,
                                distributionType: distributionType.toUpperCase(),
                                generationSource: isFaceswap ? "face_swap" : "template"
                            },

                            referenceId: request._id,
                            status: "completed",
                        },
                    ],
                    { session }
                );
            }

            // ✅ Mark as done
            freshRequest.isCommissionDistributed = true;
            await freshRequest.save({ session });

            console.log("💰 Referral distribution completed:", distributionType);

        });
    } catch (err) {
        console.error("❌ Referral distribution failed:", err);
        throw err;
    } finally {
        session.endSession();
    }
};