import { Worker } from "bullmq";

import {
    buildPrompt,
} from "../../services/AiStudio/PromptGeneration/buildPrompt.js";

import {
    getGeneration,
    markProcessing,
    markCompleted,
    markFailed,
} from "../../services/AiStudio/PromptGeneration/generationHelpers.js";

import { generateWithOpenAI } from "../../services/aiService.js";
import { uploadGeneratedImage } from "../../services/AiStudio/PromptGeneration/uploadGeneratedImage.js";
// import { deductCredits } from "../../services/AiStudio/PromptGeneration/deductCredits.js";
import { deductDynamicCredit } from "../../utils/creditTracker.js";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import PromptTemplate from "../../models/AiStudio/PromptTemplate.js";
import { createMediaDocument } from "../../controllers/SocialMedia/MediaStoreController.js";
import PromptImageTemplateSetting from "../../models/PromptImageTemplateSetting.js";
import PromptTemplateGeneration from "../../models/AiStudio/PromptTemplateGeneration.js";
import { logAndFormatAiError } from "../../utils/aiErrorHandler.js";
import socketService from "../../socket.js";



export const promptTemplateWorker =
    new Worker(

        "prompt-template-queue",

        async (job) => {

            const {
                generationId,
            } = job.data;

            logger.info(
                `[Prompt Template] Processing ${generationId}`
            );

            let generation = null;

            try {

                generation =
                    await getGeneration(
                        generationId
                    );

                if (
                    generation.status === "completed"
                ) {

                    logger.info(
                        `[Prompt Template] ${generationId} already completed`
                    );

                    return;
                }

                await markProcessing(
                    generation
                );

                const template =
                    await PromptTemplate.findById(
                        generation.templateId
                    );

                if (!template) {
                    throw new Error(
                        "Prompt template not found."
                    );
                }

                /**
                 * Build Prompt
                 *
                 * Returns
                 *
                 * {
                 *    prompt,
                 *    images
                 * }
                 */

                const {
                    prompt,
                    images,
                } =
                    await buildPrompt({

                        template,

                        generation,

                    });

                logger.info(
                    `[Prompt Template] Prompt prepared with ${images.length} reference images.`
                );

                /* ------------------------------------------------------- */
                /*                 OpenAI Image Generation                  */
                /* ------------------------------------------------------- */

                const promptSettings = await PromptImageTemplateSetting.findOne().lean();

                if (!promptSettings) {
                    throw new Error("Prompt image template settings not found.");
                }

                const qualityConfig =
                    promptSettings.pricing?.[generation.providerConfig.quality];

                if (!qualityConfig) {
                    throw new Error(
                        `Pricing configuration missing for "${generation.providerConfig.quality}" quality.`
                    );
                }

                const result = await generateWithOpenAI({
                    prompt,
                    images,
                    responseModel: generation.providerConfig.responseModel,
                    imageModel: generation.providerConfig.imageModel,
                    quality: generation.providerConfig.quality,
                    size: generation.providerConfig.size,
                    background: generation.providerConfig.background,
                    outputFormat: generation.providerConfig.outputFormat,

                    bufferPercentage: qualityConfig?.buffer || 100,
                    marginPercentage: qualityConfig?.margin || 20,
                });

                if (!result.success) {

                    throw new Error(
                        result.error ||
                        "OpenAI image generation failed."
                    );

                }

                logger.info(
                    `[Prompt Template] OpenAI generation completed for ${generationId}`
                );

                /* ------------------------------------------------------- */
                /*                    Upload Generated Image               */
                /* ------------------------------------------------------- */

                const uploadedImage =
                    await uploadGeneratedImage({

                        generationId:
                            generation._id,

                        base64:
                            result.base64,

                        outputFormat:
                            generation.providerConfig.outputFormat,

                    });

                logger.info(
                    `[Prompt Template] Generated image uploaded for ${generationId}`
                );

                /* ------------------------------------------------------- */
                /*                   Deduct Wallet Credits                 */
                /* ------------------------------------------------------- */

                // await deductCredits({

                //     userId:
                //         generation.userId,

                //     credits:
                //         generation.creditAmount,

                //     referenceId:
                //         generation._id,

                //     referenceType:
                //         "prompt_template",

                // });

                const deductionCost = result?.pricing?.chargeableCost?.inr

                if (!generation.isFreeGeneration) {


                    await deductDynamicCredit({
                        userId: generation.userId,
                        featureKey: generation?.templateId,
                        usageCount: 1,
                        referenceId: generation._id,
                        creditAmount: deductionCost,
                        serviceName: "Prompt image template generation",
                        referenceModel: "PromptTemplateGeneration",
                        description: "Prompt Template generation",
                        idempotencyKey: `ai-${generation?.templateId}-gen-${generation._id}`,
                        metadata: {
                            mediaUrl: uploadedImage.url || null,
                            source: "prompt-templates-images",
                            mediaType: "image"
                        },
                    });
                }

                logger.info(
                    `[Prompt Template] Credits deducted for ${generationId}`
                );

                await createMediaDocument({
                    userId: generation.userId,
                    chatId: generation?.templateId,
                    messageId: generation._id,
                    imageThumbnailUrl: uploadedImage.url,
                    mediaUrl: uploadedImage.url,
                    mediaType: 'image',
                    callBy: "worker",
                    generationSource: "Feeds-PromptTemplateImage"
                });

                /* ------------------------------------------------------- */
                /*                    Update Generation                    */
                /* ------------------------------------------------------- */

                await markCompleted({

                    generation,

                    creditAmount: generation.isFreeGeneration
                        ? 0
                        : deductionCost,

                    paymentStatus: "paid",

                    outputImageUrl:
                        uploadedImage.url,

                    outputImageKey:
                        uploadedImage.key,

                    usage:
                        result.usage,

                    pricing:
                        result.pricing,

                    providerResponse:
                    {
                        responseModel:
                            result.pricing.responseModel,

                        imageModel:
                            result.pricing.imageModel,
                    },

                    finalPrompt:
                        prompt,

                });

                logger.info(
                    `[Prompt Template] Generation completed successfully ${generationId}`
                );

                return;

            } catch (error) {

                logger.error(
                    "[Prompt Template Worker]",
                    error
                );

                const formatted = await logAndFormatAiError(error, "OpenAI", {
                    userId: generation?.userId,
                    feature: "promptTemplateWorker",
                    generationId,
                });

                const maxAttempts = job.opts?.attempts || 1;
                const isFinalAttempt = !job.opts?.attempts || job.attemptsMade >= maxAttempts;

                if (isFinalAttempt) {
                    if (generation?.userId) {
                        socketService.emitToUser(generation.userId, "promptTemplate:failed", {
                            generationId,
                            error: formatted.userMessage,
                            errorCode: formatted.errorCode,
                        });
                    }

                    if (generation?._id) {
                        await PromptTemplateGeneration.findByIdAndDelete(generation._id).catch(() => {});
                    }
                }

                throw error;

            }

        },

        {
            connection: redisClient,

            concurrency: 2,

            removeOnComplete: {
                count: 1000,
            },

            removeOnFail: {
                count: 500,
            },

            limiter: {
                max: 2,
                duration: 1000,
            },

        }

    );


promptTemplateWorker.on(
    "completed",
    (job) => {

        logger.info(
            `[Prompt Template] Job ${job.id} completed`
        );

    }
);

promptTemplateWorker.on(
    "failed",
    (job, err) => {

        logger.error(
            `[Prompt Template] Job ${job?.id} failed`,
            err
        );

    }
);

promptTemplateWorker.on(
    "error",
    (err) => {

        logger.error(
            "[Prompt Template Worker Error]",
            err
        );

    }
);