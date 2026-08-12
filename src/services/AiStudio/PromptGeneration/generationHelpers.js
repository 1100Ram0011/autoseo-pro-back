import PromptTemplateGeneration from "../../../models/AiStudio/PromptTemplateGeneration.js";

/* -------------------------------------------------------------------------- */
/*                             Load Generation                                */
/* -------------------------------------------------------------------------- */

export const getGeneration = async (generationId) => {
    const generation =
        await PromptTemplateGeneration.findById(generationId);

    if (!generation) {
        throw new Error("Generation request not found.");
    }

    return generation;
};

/* -------------------------------------------------------------------------- */
/*                            Processing Status                               */
/* -------------------------------------------------------------------------- */

export const markProcessing = async (generation) => {
    generation.status = "processing";
    generation.startedAt = new Date();
    generation.attempts += 1;

    await generation.save();

    return generation;
};

/* -------------------------------------------------------------------------- */
/*                             Completed Status                               */
/* -------------------------------------------------------------------------- */

export const markCompleted = async ({
    generation,
    creditAmount,
    outputImageUrl,
    outputImageKey,

    usage,
    pricing,

    providerResponse,
    finalPrompt,
}) => {
    generation.creditAmount = creditAmount
    generation.status = "completed";
    generation.paymentStatus = 'paid';

    generation.completedAt =
        new Date();

    generation.outputImageUrl =
        outputImageUrl;

    generation.outputImageKey =
        outputImageKey;

    generation.finalPrompt =
        finalPrompt;

    generation.usage =
        usage || {};

    generation.pricing =
        pricing || {};

    generation.providerResponse =
        providerResponse || null;

    generation.error = {};

    await generation.save();

    return generation;

};

/* -------------------------------------------------------------------------- */
/*                               Failed Status                                */
/* -------------------------------------------------------------------------- */

export const markFailed = async ({
    generation,

    step = "worker",

    error,
}) => {

    generation.status = "failed";

    generation.completedAt =
        new Date();

    generation.error = {

        step,

        message:
            error?.message ||
            "Unknown Error",

        raw:
            error?.response?.data ||
            error ||
            null,

    };

    await generation.save();

    return generation;

};


export const loadGenerationContext = async (
    generationId
) => {

    const generation =
        await PromptTemplateGeneration
            .findById(generationId)
            .populate("templateId");

    if (!generation) {

        throw new Error(
            "Generation not found."
        );

    }

    return {

        generation,

        template:
            generation.templateId,

    };

};