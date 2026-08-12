//AvatarService.js
import axios from "axios";
import FormData from "form-data";
import httpStatus from "http-status";

import ApiError from "../../utils/ApiError.js";

import config from "../../config/config.js";
import logger from "../../config/logger.js";
import { deleteFromS3, uploadToS3 } from "../../utils/upload.js";
import Avatar from "../../models/AiStudio/AvatarModel.js";
import HeyGenAvatar from "../../models/AiStudio/HeyGenAvatarModel.js";
import path from "path";
import HeyGenClient, { VideoHelper } from "./HeyGen/index.js";
import { runHeyGenPipeline, pollIntroVideoStatus } from "./HeyGenPipelineService.js";
import { type } from "os";

const heygen = new HeyGenClient({
    apiKey: config.HEYGEN_API_KEY || process.env.HEYGEN_API_KEY,
});

/*
|--------------------------------------------------------------------------
| Private Helpers
|--------------------------------------------------------------------------
*/

const IMAGE_FIELDS = [
    "front",
    // "left",
    // "right",
    // "back",
    // "full_body",
];

const ensureImageFiles = (files) => {

    if (!files) {

        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "Please upload avatar images."
        );

    }

    for (const field of IMAGE_FIELDS) {

        if (!files[field] || files[field].length === 0) {

            throw new ApiError(
                httpStatus.BAD_REQUEST,
                `${field} image is required.`
            );

        }

    }

};

const buildImageFormData = (files) => {

    const form = new FormData();

    form.append("front", files.front[0].buffer, {
        filename: files.front[0].originalname,
        contentType: files.front[0].mimetype,
    });

    form.append("left", files.left[0].buffer, {
        filename: files.left[0].originalname,
        contentType: files.left[0].mimetype,
    });

    form.append("right", files.right[0].buffer, {
        filename: files.right[0].originalname,
        contentType: files.right[0].mimetype,
    });

    form.append("back", files.back[0].buffer, {
        filename: files.back[0].originalname,
        contentType: files.back[0].mimetype,
    });

    // 👇 FastAPI expects full_body
    form.append("full_body", files.full_body[0].buffer, {
        filename: files.full_body[0].originalname,
        contentType: files.full_body[0].mimetype,
    });

    return form;
};
const handleAxiosError = (error, defaultMessage) => {

    logger.error(error);
    // console.log('error.response', error.response?.data?.detail)

    if (error.response) {

        throw new ApiError(

            error.response.status ||

            httpStatus.BAD_REQUEST,

            error.response.data?.message || error.response?.data?.detail?.message ||
            defaultMessage

        );

    }

    throw new ApiError(

        httpStatus.INTERNAL_SERVER_ERROR,

        defaultMessage

    );

};

/*
|--------------------------------------------------------------------------
| Validate Avatar Images
|--------------------------------------------------------------------------
*/

export const validateAvatarImages = async (files) => {

    // console.log('files', files)

    ensureImageFiles(files);

    const formData = buildImageFormData(files);

    try {

        const response = await axios.post(

            `${config.FAST_API_SERVER}/moderation/photo-verify/check-batch`,

            formData,

            {

                headers: formData.getHeaders(),

                timeout: 180000,

                maxBodyLength: Infinity,

                maxContentLength: Infinity,

            }

        );


        console.log('response', response)

        const data = response?.data

        /*
        |--------------------------------------------------------------------------
        | Normalize Response
        |--------------------------------------------------------------------------
        */

        return {

            success: data?.overall_passed || false,

            message: data?.overall_passed
                ? "Images validated successfully."
                : "Image validation failed.",

            data,

        };

    } catch (error) {

        handleAxiosError(

            error,

            "Unable to validate avatar images."

        );

    }

};

/*
|--------------------------------------------------------------------------
| Validate Avatar Video
|--------------------------------------------------------------------------
*/

export const validateAvatarVideo = async (file) => {

    if (!file) {
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "Please upload an avatar introduction video."
        );
    }

    let tempVideoUrl = null;

    try {

        /*
        |--------------------------------------------------------------------------
        | Upload Temporary Video To S3
        |--------------------------------------------------------------------------
        */

        const extension =
            path.extname(file.originalname) || ".mp4";

        const fileName =
            `${Date.now()}${extension}`;

        tempVideoUrl = await uploadToS3(
            file.buffer,
            fileName,
            "ai-studio/avatar/temp/videos",
            file.mimetype,
            "inline"
        );

        console.log('tempVideo', tempVideoUrl)

        /*
        |--------------------------------------------------------------------------
        | Moderate Video
        |--------------------------------------------------------------------------
        */

        const { data } = await axios.post(

            `${config.FAST_API_SERVER}/moderation/analyze`,

            {
                url: tempVideoUrl,
                contentType: "video",
            },

            {
                timeout: 600000,
            }

        );

        return {

            success: data?.final === "Safe",

            message:
                data?.final === "Safe"
                    ? "Video validation completed."
                    : "Video moderation failed.",

            data,

        };

    } catch (error) {
        console.error("Video Validation Error:", error);
        // console.error("Axios Response:", error?.response?.data);
        // console.error("Axios Status:", error?.response?.status);
        // console.error("Axios Message:", error?.message);

        handleAxiosError(
            error,
            "Unable to validate avatar video."
        );

    } finally {

        /*
        |--------------------------------------------------------------------------
        | Delete Temporary Video
        |--------------------------------------------------------------------------
        */

        if (tempVideoUrl) {

            try {
                setTimeout(async () => {
                    await deleteFromS3(tempVideoUrl);

                }, 60000)


            } catch (cleanupError) {

                logger.error(
                    "Failed to delete temporary avatar video.",
                    cleanupError
                );

            }

        }

    }

};

/*
|--------------------------------------------------------------------------
| Validate Avatar Audio
|--------------------------------------------------------------------------
*/

export const validateAvatarAudio = async (file) => {

    if (!file) {

        throw new ApiError(

            httpStatus.BAD_REQUEST,

            "Please upload a voice sample."

        );

    }

    const formData = new FormData();

    formData.append(
        "file",
        file.buffer,
        {
            filename: file.originalname,
            contentType: file.mimetype,
        }
    );

    try {

        const { data } = await axios.post(

            `${config.FAST_API_SERVER}/moderation/audio-verify/check`,

            formData,

            {

                headers: formData.getHeaders(),

                timeout: 180000,

                maxBodyLength: Infinity,

                maxContentLength: Infinity,

            }

        );

        return {

            success: data?.passed || false,

            message: data?.passed
                ? "Audio validation completed successfully."
                : data?.primary_reason ||
                "Audio validation failed.",

            data,

        };

    } catch (error) {

        handleAxiosError(

            error,

            "Unable to validate avatar audio."

        );

    }

};

/*
|--------------------------------------------------------------------------
| Create AI Avatar
|--------------------------------------------------------------------------
*/

export const createAiAvatar = async ({
    userId,
    body,
    files,
}) => {

    if (!userId) {

        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "User is required."
        );

    }

    ensureImageFiles(files);

    if (!files?.video?.length) {

        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "Avatar introduction video is required."
        );

    }

    if (!files?.audio?.length) {

        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "Voice sample is required."
        );

    }

    /*
    |--------------------------------------------------------------------------
    | Check Existing Avatar
    |--------------------------------------------------------------------------
    */

    const existingAvatar = await Avatar.findOne({
        userId,
    });

    if (existingAvatar) {
        return {
            success: false,
            message: 'Avatar already exits'
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Upload Images
    |--------------------------------------------------------------------------
    */

    const uploadedImages = {};

    for (const field of IMAGE_FIELDS) {

        const image = files[field][0];

        const key = `${Date.now()}-${image.originalname}`;

        const url = await uploadToS3(

            image.buffer,

            key,

            `ai-studio/avatar/${userId}/images`,

            image.mimetype

        );

        uploadedImages[field] = {

            url,

            key,

            fileName: image.originalname,

            mimeType: image.mimetype,

            size: image.size,

        };

    }

    /*
    |--------------------------------------------------------------------------
    | Upload Video
    |--------------------------------------------------------------------------
    */

    const video = files.video[0];

    const videoKey = `${Date.now()}-${video.originalname}`;

    const videoUrl = await uploadToS3(

        video.buffer,

        videoKey,

        `ai-studio/avatar/${userId}/video`,

        video.mimetype

    );

    /*
    |--------------------------------------------------------------------------
    | Upload Audio
    |--------------------------------------------------------------------------
    */

    const audio = files.audio[0];

    const audioKey = `${Date.now()}-${audio.originalname}`;

    const audioUrl = await uploadToS3(

        audio.buffer,

        audioKey,

        `ai-studio/avatar/${userId}/audio`,

        audio.mimetype

    );

    /*
    |--------------------------------------------------------------------------
    | Create / Upsert Avatar in DB
    |--------------------------------------------------------------------------
    */

    const avatarPayload = {

        userId,

        status: "READY_FOR_TRAINING",

        verificationStatus: "PASSED",

        images: {

            ...uploadedImages,

        },

        video: {

            url: videoUrl,

            key: videoKey,

            fileName: video.originalname,

            mimeType: video.mimetype,

            size: video.size,

        },

        audio: {

            url: audioUrl,

            key: audioKey,

            fileName: audio.originalname,

            mimeType: audio.mimetype,

            size: audio.size,

        },

        verificationSummary: {

            imagePassed: true,

            videoPassed: true,

            audioPassed: true,

            overallPassed: true,

            verifiedAt: new Date(),

        },

        training: {

            modelId: "",

            voiceId: "",

            provider: "heygen",

            startedAt: new Date(),

            completedAt: null,

            failedReason: "",

            metadata: {},

        },

    };

    const avatar = await Avatar.findOneAndUpdate(
        { userId },
        avatarPayload,
        { upsert: true, new: true, runValidators: true }
    );

    // Trigger Automated HeyGen Worker Pipeline asynchronously
    runHeyGenPipeline({ userId, avatarRecord: avatar, body }).catch((err) => {
        logger.error("Error triggering HeyGen pipeline in background:", err);
    });

    return {

        success: true,

        message: "Avatar and Voice created successfully. HeyGen pipeline triggered.",

        data: avatar,

    };

};
/*
|--------------------------------------------------------------------------
| Get AI Avatar
|--------------------------------------------------------------------------
*/

export const getAiAvatar = async (userId) => {

    if (!userId) {

        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "User is required."
        );

    }

    const avatar = await Avatar.findOne({ userId }).lean();

    return avatar || null;

};

/*
|--------------------------------------------------------------------------
| Get AI Avatar Status
|--------------------------------------------------------------------------
*/

export const getAiAvatarStatus = async (userId) => {

    if (!userId) {

        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "User is required."
        );

    }

    const avatar = await Avatar.findOne({ userId })
        .select(
            `
            status
            verificationStatus
            verificationSummary
            training
            createdAt
            updatedAt
            images.front.url
            images.left.url
            images.right.url
            images.back.url
            images.full_body.url
            video.url
            audio.url
            `
        )
        .lean();

    return {

        success: true,

        message: avatar ? "Avatar status fetched successfully." : "Avatar not created yet.",

        data: avatar || null,

    };

};

/*
|--------------------------------------------------------------------------
| Get Detailed HeyGen Avatar Pipeline Status
|--------------------------------------------------------------------------
*/

export const getHeyGenAvatarDetailedStatus = async (userId) => {

    if (!userId) {
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "User is required."
        );
    }

    const heygenRecord = await HeyGenAvatar.findOne({ userId }).lean();

    return {
        success: true,
        message: heygenRecord ? "HeyGen avatar pipeline status fetched." : "HeyGen pipeline not triggered yet.",
        data: heygenRecord || null,
    };

};


/*
|--------------------------------------------------------------------------
| Test Function: Create Look & Generate Video Script with Same Voice
|--------------------------------------------------------------------------
*/
export const testCreateLookAndVideo = async (options = {}, customScriptParam = "", engineParam = "avatar_iv") => {
    let heygenAvatarId, customScript, engine, talkingStyle, emotion, superResolution, avatarStyle, newImageUrl;

    if (typeof options === "object" && options !== null && !Array.isArray(options)) {
        heygenAvatarId = options.heygenAvatarId || options.id || options.targetId;
        customScript = options.customScript || options.script || "";
        engine = options.engine || "avatar_iv";
        talkingStyle = options.talkingStyle || options.talking_style || "expressive";
        emotion = options.emotion || "FRIENDLY";
        superResolution = options.superResolution ?? true;
        avatarStyle = options.avatarStyle || options.avatar_style || "normal";
        newImageUrl = options.newImageUrl || options.image_url || null;
    } else {
        heygenAvatarId = options;
        customScript = customScriptParam || "";
        engine = engineParam || "avatar_iv";
        talkingStyle = "expressive";
        emotion = "FRIENDLY";
        superResolution = true;
        avatarStyle = "normal";
    }

    if (!heygenAvatarId) {
        throw new ApiError(httpStatus.BAD_REQUEST, "HeyGenAvatar ID or User ID is required.");
    }

    // 1. Fetch HeyGenAvatar document from DB by _id or userId
    let heygenRecord = await HeyGenAvatar.findById(heygenAvatarId);
    if (!heygenRecord) {
        heygenRecord = await HeyGenAvatar.findOne({ userId: heygenAvatarId });
    }

    if (!heygenRecord) {
        throw new ApiError(httpStatus.NOT_FOUND, `HeyGenAvatar record not found for ID: ${heygenAvatarId}`);
    }

    const avatarId = heygenRecord.heygen?.clone?.avatar_id || heygenRecord.training?.modelId;
    const voiceId = heygenRecord.heygen?.voice?.voice_id || heygenRecord.training?.voiceId;

    if (!avatarId) {
        throw new ApiError(httpStatus.BAD_REQUEST, "Avatar ID (clone) is missing in HeyGenAvatar record.");
    }
    if (!voiceId) {
        throw new ApiError(httpStatus.BAD_REQUEST, "Voice ID (clone) is missing in HeyGenAvatar record.");
    }

    const celebrityName = heygenRecord.celebrityProfile?.stageName || heygenRecord.celebrityProfile?.fullName || "AI Clone";

    // 2. Fetch or Create Avatar Look via official POST /v3/avatars endpoint (Prompt or Photo)
    let lookData = null;
    let lookId = avatarId;
    const resolvedMotionPrompt = (typeof options === "object" && options !== null && (options.motionPrompt || options.motion_prompt))
        ? (options.motionPrompt || options.motion_prompt)
        : `gesturing naturally while speaking`;

    const lookPrompt = typeof options === "object" && options !== null ? (options.prompt || options.lookPrompt || options.look_prompt) : null;

    if (lookPrompt) {
        try {
            lookData = await heygen.avatar.createPromptAvatar({
                prompt: lookPrompt,
                avatar_id: avatarId,
                name: `${celebrityName} Prompt Look`,
                motion_prompt: resolvedMotionPrompt,
                expressiveness: "high",
            });
            lookId = lookData?.avatar_item?.id || lookData?.avatar_id || lookData?.id || lookData?.data?.avatar_id || avatarId;
        } catch (e) {
            logger.warn("createPromptAvatar for look failed, fallback to photo or default look:", e);
        }
    }

    if (!lookData && newImageUrl) {
        try {
            lookData = await heygen.avatar.createPhotoAvatar({
                imageUrl: newImageUrl,
                name: `${celebrityName} Look`,
                motion_prompt: resolvedMotionPrompt,
                expressiveness: "high",
            });
            lookId = lookData?.avatar_item?.id || lookData?.avatar_id || lookData?.id || lookData?.data?.avatar_id || avatarId;
        } catch (e) {
            logger.warn("createPhotoAvatar for new look failed, fallback to default avatarId:", e.message);
        }
    }

    if (!lookData) {
        try {
            const looksList = await heygen.avatar.listLooks({ avatar_id: avatarId });
            lookData = Array.isArray(looksList) ? looksList[0] : (looksList?.looks?.[0] || looksList || {});
            lookId = lookData?.look_id || lookData?.id || avatarId;
        } catch (err) {
            logger.warn("listLooks fallback:", err.message);
            lookData = { look_id: avatarId, name: `${celebrityName} Default Look` };
            lookId = avatarId;
        }
    }

    // console.log('Look Data', lookData)
    // return lookData

    // 3. Construct Video Script & Motion Prompt
    const scriptText = `Hi, this is ${celebrityName}, an AI clone from Borade AI. You can book me for brand advertisements, events, promotional films, personalized greetings, and custom video messages.`;
    const resolvedEngine = engine ? (typeof engine === "object" ? engine : { type: engine }) : { type: "avatar_iv" };


    let videoResult;
    const DEFAULT_FALLBACK_VOICE_ID = "df54a052be30416e97ab3ff0f091986a";
    const primaryVoiceId = voiceId || DEFAULT_FALLBACK_VOICE_ID;

    try {
        const videoPayload = VideoHelper.buildVideoPayload({
            title: `Test_${celebrityName}_${Date.now()}`,
            avatarId: lookId || avatarId,
            voiceId: primaryVoiceId,
            script: customScript || scriptText,
            engine: resolvedEngine,
            motionPrompt: resolvedMotionPrompt,
            expressiveness: (typeof options === "object" && options !== null && options.expressiveness) ? options.expressiveness : "high",
            aspectRatio: "16:9",
            dimension: {
                width: 1920,
                height: 1080,
            },
        });
        videoResult = await heygen.video.generateVideo(videoPayload);
    } catch (videoErr) {
        const errText = (videoErr?.message || "").toLowerCase();
        if (errText.includes("voice not found") || errText.includes("invalid voice_id") || errText.includes("voice_id")) {
            logger.warn(`Voice ID '${primaryVoiceId}' not ready or invalid. Retrying video generation with fallback voice ID '${DEFAULT_FALLBACK_VOICE_ID}'...`);
            const fallbackPayload = VideoHelper.buildVideoPayload({
                title: `Test_${celebrityName}_${Date.now()}`,
                avatarId: lookId || avatarId,
                voiceId: DEFAULT_FALLBACK_VOICE_ID,
                script: customScript || scriptText,
                engine: resolvedEngine,
                motionPrompt: resolvedMotionPrompt,
                expressiveness: (typeof options === "object" && options !== null && options.expressiveness) ? options.expressiveness : "high",
                aspectRatio: "16:9",
                dimension: {
                    width: 1920,
                    height: 1080,
                },
            });
            videoResult = await heygen.video.generateVideo(fallbackPayload);
        } else {
            throw videoErr;
        }
    }
    const videoId = videoResult?.video_id || videoResult?.id || videoResult?.data?.video_id || "";

    // 5. Update HeyGenAvatar document with look, pipeline status and initial video details
    heygenRecord.status = "GENERATING_INTRO_VIDEO";
    heygenRecord.pipelineProgress = 85;
    heygenRecord.currentStepMessage = "Video rendering triggered with Avatar Engine IV & expressive gestures. Polling status until completion...";

    // heygenRecord.heygen.looks = [
    //     {
    //         look_id: lookId,
    //         name: lookData?.name || `${celebrityName} Look`,
    //         image_url: lookData?.preview_image_url || lookData?.image_url || "",
    //         status: "ready",
    //         response: lookData,
    //     },
    // ];

    heygenRecord.heygen.introVideo = {
        video_id: videoId,
        status: "processing",
        duration: 15,
        script: customScript || scriptText,
        response: videoResult,
    };

    heygenRecord.rawResponses = {
        ...heygenRecord.rawResponses,
        // testLook: lookData,
        testVideoGeneration: videoResult,
    };

    await heygenRecord.save();

    // 6. Launch background status polling to update DB schema (HeyGenAvatar & Avatar) when video completes
    if (videoId) {
        pollIntroVideoStatus({ userId: heygenRecord.userId, heygenAvatarId: heygenRecord._id, videoId });
    }

    return {
        success: true,
        message: "Look retrieved/remixed, avatar_iv video generation triggered with motion prompt, and status polling started.",
        data: {
            heygenAvatarId: heygenRecord._id,
            avatarId: lookId,
            voiceId,
            videoId,
            engine: resolvedEngine,
            motionPrompt: resolvedMotionPrompt,
            talkingStyle: talkingStyle || "expressive",
            emotion: emotion || "FRIENDLY",
            script: customScript || scriptText,
            status: "GENERATING_INTRO_VIDEO",
            // lookData,
            videoResult,
        },
    };
};


const createAv = async () => {
    /*
   |--------------------------------------------------------------------------
   | HeyGen API Creation (Photo Avatar & Voice Clone)
   |--------------------------------------------------------------------------
   */

    const demoData = await Avatar.findById('6a673bffc5d19597db601e79').populate('userId')
    const audioUrl = demoData?.audio?.url


    let heygenAvatar = null;
    let heygenVoice = null;
    let heygenErrorReason = null;

    try {
        const apiKey = config.HEYGEN_API_KEY || process.env.HEYGEN_API_KEY;
        console.log('apiKey', apiKey)
        if (apiKey) {
            const avatarName = demoData?.userId?.name || "test demo";

            // Create Photo Avatar in HeyGen using Full Body or Front image URL
            const photoImageUrl = demoData?.images?.full_body?.url || demoData?.images?.front?.url;
            // if (photoImageUrl) {
            //     heygenAvatar = await heygen.avatar.createPhotoAvatar({
            //         imageUrl: photoImageUrl,
            //         name: avatarName,
            //         gender: "male",
            //     });
            // }

            // Create Instant Voice Clone in HeyGen
            if (audioUrl) {
                heygenVoice = await heygen.voiceClone.createInstantClone({
                    name: `Voice_${avatarName}`,
                    audioUrl: audioUrl,
                });
            }
        }

        console.log(heygenVoice)
    } catch (err) {
        logger.error("HeyGen API integration error during avatar creation:", err);
        heygenErrorReason = err.message || "Failed to create HeyGen avatar model";
    }
}

const checkAvtr = async () => {
    const list = await heygen.avatar.listLooks()
    console.log("list of avatars", list)
    // const listVoice = await heygen.avatar.listLooks()
    // console.log("list of voices", listVoice)
}


async function testCreateVideo() {

    try {

        const response = await heygen.video.generate({

            avatarId: "870ec465f1de43f4a564ca6203e7e0cd",

            voiceId: "df54a052be30416e97ab3ff0f091986a",

            script: `
Hello everyone!`,

            title: "Avatar III Motion Test",

            aspectRatio: "16:9",

            engine: {
                type: "avatar_iii",
            },

            motionPrompt: `
The avatar should speak confidently while maintaining eye contact.
Use smooth and realistic hand gestures throughout the presentation.
Occasionally gesture with both hands when emphasizing important points.
Smile naturally.
Nod when introducing key ideas.
Keep posture relaxed and professional.
Avoid repetitive or exaggerated movements.
            `,

            expressiveness: "high",

        });

        console.log("\n========== VIDEO CREATED ==========\n");

        console.dir(response, { depth: null });

        const videoId =
            response?.video_id ||
            response?.id ||
            response?.data?.video_id;

        console.log("\nVideo ID:", videoId);

    } catch (error) {

        console.error("\n========== ERROR ==========\n");

        console.dir(
            error?.response?.data || error,
            { depth: null }
        );

    }

}

const runPipline = async () => {
    const userId = '69ca5fe85a9b1e733335eaef'
    const avatar = await Avatar.findOne({ userId })

    // Trigger Automated HeyGen Worker Pipeline asynchronously
    runHeyGenPipeline({ userId, avatarRecord: avatar }).catch((err) => {
        logger.error("Error triggering HeyGen pipeline in background:", err);
    });

}

/**
 * Testing function for HeyGen Video Agent creation via POST /v3/video-agents
 * Reference: https://developers.heygen.com/docs/video-agent
 *
 * @param {string|Object} avatar - Avatar ID string, or options object
 * @param {string} voice - Voice ID string
 * @param {string} prompt - Video prompt instruction
 * @param {Array<string>|string} [imageUrls] - Optional file/image URL(s)
 * @param {Object} [extraOptions] - Additional options (e.g. orientation)
 * @returns {Promise<Object>} Response from POST /v3/video-agents
 */
export async function testCreateHeyGenVideo(avatar, voice, prompt, imageUrls, extraOptions = {}) {
    let avatarId = "";
    let voiceId = "";
    let promptText = "";
    let images = null;
    let options = {};

    if (typeof avatar === "object" && avatar !== null && !avatar._id) {
        avatarId = avatar.avatarId || avatar.avatar_id || avatar.avatar || avatar.lookId || avatar.look_id || "";
        voiceId = avatar.voiceId || avatar.voice_id || avatar.voice || voice || "";
        promptText = avatar.prompt || avatar.text || prompt || "";
        images = avatar.imageUrls || avatar.image_urls || avatar.images || avatar.imageUrl || avatar.image_url || avatar.files || imageUrls;
        options = avatar;
    } else {
        avatarId = typeof avatar === "string" ? avatar : (avatar?._id || avatar?.avatarId || avatar?.lookId || "");
        voiceId = typeof voice === "string" ? voice : (voice?.voiceId || voice?.voice_id || "");
        promptText = typeof prompt === "string" ? prompt : (prompt?.prompt || prompt?.text || "");
        images = imageUrls;
        options = extraOptions;
    }

    const apiKey = config.HEYGEN_API_KEY || process.env.HEYGEN_API_KEY;
    if (!apiKey) {
        throw new Error("HeyGen API key is missing in config or environment.");
    }

    const heygenClient = heygen;

    // Format files array per Video Agent API specification (https://developers.heygen.com/docs/video-agent#request-body)
    let filesArr = [];
    if (images) {
        if (Array.isArray(images)) {
            filesArr = images.filter(Boolean).map((item) => {
                if (typeof item === "string") return { type: "url", url: item.trim() };
                if (typeof item === "object" && item !== null) {
                    if (item.type && (item.url || item.id)) return item;
                    if (item.url) return { type: "url", url: item.url };
                    if (item.id || item.asset_id) return { type: "asset_id", id: item.id || item.asset_id };
                }
                return item;
            });
        } else if (typeof images === "string" && images.trim()) {
            filesArr = [{ type: "url", url: images.trim() }];
        } else if (typeof images === "object" && images !== null) {
            if (images.type && (images.url || images.id)) filesArr = [images];
            else if (images.url) filesArr = [{ type: "url", url: images.url }];
            else if (images.id || images.asset_id) filesArr = [{ type: "asset_id", id: images.id || images.asset_id }];
        }
    }

    const payload = {
        type: 'cinematic_avatar',
        prompt: promptText,
        orientation: options.orientation || options.aspectRatio || "landscape",
    };

    if (avatarId) payload.avatar_id = avatarId;
    if (voiceId) payload.voice_id = voiceId;
    if (filesArr.length > 0) payload.files = filesArr;
    if (options.callback_id || options.callbackId) payload.callback_id = options.callback_id || options.callbackId;

    logger.info(`[testCreateHeyGenVideo] Sending POST /v3/video-agents payload:`, payload);
    console.log("[testCreateHeyGenVideo] Payload for POST /v3/video-agents:\n", JSON.stringify(payload, null, 2));

    try {
        const response = await heygenClient.agent.createVideoAgent(payload);
        console.log("[testCreateHeyGenVideo] Initial response from POST /v3/video-agents:\n", response);

        const sessionId = response?.session_id || response?.data?.session_id || response?.id;
        const directVideoId = response?.video_id || response?.data?.video_id;

        if ((sessionId || directVideoId) && options.poll !== false) {
            console.log(`\n[testCreateHeyGenVideo] Starting Two-Phase Polling Workflow (15s polling interval)...`);
            try {
                const workflowResult = await heygenClient.agent.pollVideoAgentWorkflow(response, {
                    intervalMs: options.intervalMs || 15000,
                    onProgress: (res, attempt) => {
                        const status = res?.status || res?.video_status || res?.data?.status || "processing";
                        console.log(`[testCreateHeyGenVideo] Polling attempt ${attempt} - status: "${status}"`);
                    },
                });

                console.log("\n[testCreateHeyGenVideo] Two-Phase Polling Workflow Completed! Final Result:\n", JSON.stringify(workflowResult, null, 2));

                return {
                    ...response,
                    ...workflowResult,
                    video_url: workflowResult.video_url,
                };
            } catch (pollErr) {
                logger.warn(`[testCreateHeyGenVideo] Polling warning/timeout: ${pollErr.message}`);
                return {
                    ...response,
                    pollingError: pollErr.message,
                };
            }
        }

        return response;
    } catch (error) {
        logger.error("[testCreateHeyGenVideo] Error calling /v3/video-agents:", error);
        throw error;
    }
}

/**
 * Test function for HeyGen Lipsync API (Speed / Precision mode)
 * Reference: https://developers.heygen.com/lipsync-speed
 *
 * @param {string|Object} videoInput - Source video URL/Asset ID or options object
 * @param {string|Object} [audioInput] - Replacement audio URL/Asset ID
 * @param {Object} [options] - Additional options (mode, title, poll, etc.)
 * @returns {Promise<Object>} Response object from HeyGen Lipsync API
 */
export async function testLipsync(videoInput, audioInput, options = {}) {
    let video = videoInput;
    let audio = audioInput;
    let opts = options;

    // Support single options object: testLipsync({ video: "...", audio: "...", mode: "speed" })
    if (typeof videoInput === "object" && videoInput !== null && !videoInput.type && (videoInput.video || videoInput.audio || videoInput.mode)) {
        opts = videoInput;
        video = opts.video;
        audio = opts.audio;
    }

    const mode = opts.mode || "speed";
    const title = opts.title || `Test_Lipsync_${mode}_${Date.now()}`;

    if (!video || !audio) {
        logger.warn("[testLipsync] Missing video or audio input. Please provide valid video and audio URLs or Asset IDs.");
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            "Both 'video' and 'audio' inputs (URL or asset_id) are required for Lipsync test."
        );
    }

    const payloadOptions = {
        video,
        audio,
        mode,
        title,
        enable_caption: opts.enable_caption ?? opts.enableCaption ?? false,
        enable_dynamic_duration: opts.enable_dynamic_duration ?? opts.enableDynamicDuration ?? true,
        disable_music_track: opts.disable_music_track ?? opts.disableMusicTrack ?? false,
        enable_speech_enhancement: opts.enable_speech_enhancement ?? opts.enableSpeechEnhancement ?? false,
        enable_watermark: opts.enable_watermark ?? opts.enableWatermark ?? false,
        ...(opts.start_time !== undefined ? { start_time: opts.start_time } : {}),
        ...(opts.end_time !== undefined ? { end_time: opts.end_time } : {}),
        ...(opts.fps_mode ? { fps_mode: opts.fps_mode } : {}),
        ...(opts.callback_url ? { callback_url: opts.callback_url } : {}),
        ...(opts.callback_id ? { callback_id: opts.callback_id } : {}),
        ...(opts.folder_id ? { folder_id: opts.folder_id } : {}),
    };

    logger.info(`[testLipsync] Executing HeyGen Lipsync (${mode} mode) API request...`);
    console.log("[testLipsync] Payload options:\n", JSON.stringify(payloadOptions, null, 2));

    try {
        let response;
        if (opts.poll !== false) {
            console.log(`[testLipsync] Creating Lipsync job and starting polling...`);
            response = await heygen.lipsync.createAndPollLipsync(payloadOptions, {
                intervalMs: opts.intervalMs || 5000,
                timeoutMs: opts.timeoutMs || 300000,
                onProgress: (res, attempt) => {
                    const status = res?.status || res?.data?.status || "pending";
                    console.log(`[testLipsync] Polling attempt ${attempt} - status: "${status}"`);
                },
            });
            console.log("\n[testLipsync] Lipsync Completed Successfully! Result:\n", JSON.stringify(response, null, 2));
        } else {
            console.log(`[testLipsync] Creating Lipsync job (no polling)...`);
            response = await heygen.lipsync.createLipsync(payloadOptions);
            console.log("\n[testLipsync] Lipsync job created successfully:\n", JSON.stringify(response, null, 2));
        }

        return {
            success: true,
            message: `HeyGen Lipsync (${mode} mode) completed successfully.`,
            data: response,
        };
    } catch (error) {
        logger.error("[testLipsync] Error executing HeyGen Lipsync:", error);
        console.error("[testLipsync] Error details:", error?.response?.data || error?.message || error);
        throw error;
    }
}

export const testCreateLipsync = testLipsync;


// setTimeout(async () => {
//     // const result = await testCreateLookAndVideo({
//     //     targetId: "6a69e7bc1c4ed8dcb6bbe033",
//     //     script: "Testing my AI clone with a prompt-generated look in formal business attire.",
//     //     engine: "avatar_iv",
//     //     motionPrompt: "Speak confidently while maintaining eye contact. Use natural hand gestures and smile.",
//     //     expressiveness: "high",
//     // });
//     // console.log(result);
//     // const checkRes = await testCreateLookAndVideo({ heygenAvatarId: '6a689049307777bd80b14fa1' })
//     // console.log("checkres", checkRes)
//     runPipline()
//     // testCreateVideo()
// }, 10000)


// setTimeout(async () => {
//     const result = await testCreateHeyGenVideo("74f4ff9e3d35467384d1003ba35789e6",
//         "910f5bec67d943459fd0dc00d30fcdee",
//         `Create a premium 10–15 second cinematic introduction video featuring the avatar delivering a confident walking introduction.

// ## Video Style
// - Premium commercial quality
// - Modern AI technology brand
// - Clean, minimal, and futuristic
// - Professional yet approachable
// - Natural human expressions
// - Smooth cinematic pacing
// - High-end lighting and color grading

// ## Environment

// The avatar walks naturally through a luxurious modern office with floor-to-ceiling glass walls, elegant interiors, subtle blue ambient lighting, digital displays, and premium workspace aesthetics. The environment should feel like the headquarters of an innovative AI company, with cinematic depth of field and realistic background activity.

// ## Camera Direction

// **Opening**
// - Begin with a medium-wide tracking shot.
// - The avatar is already walking confidently toward the camera.
// - The camera smoothly tracks backward while maintaining eye level.
// - Natural walking pace with relaxed posture and a friendly smile.

// **Middle**
// - Transition into a waist-up tracking shot while the avatar continues walking.
// - Maintain direct eye contact with the camera.
// - Natural blinking, subtle facial expressions, and realistic lip sync.
// - Use gentle cinematic camera movement.

// **Ending**
// - The avatar slows to a stop near the end of the dialogue.
// - Camera performs a subtle push-in.
// - Finish with a confident smile while maintaining eye contact.

// ## Avatar Behavior

// - Walk naturally throughout the introduction.
// - Relaxed shoulders and natural arm swing.
// - Subtle hand gestures while speaking.
// - Friendly facial expressions.
// - Confident and engaging body language.
// - Occasional head nods.
// - No exaggerated movements.
// - Maintain a conversational and professional presence.

// ## Voice Style

// - Warm
// - Friendly
// - Confident
// - Professional
// - Natural conversational delivery
// - Smooth pacing with realistic pauses

// ## On-Screen Text

// BORADE AI

// AI Celebrity & Avatar Platform

// Book Your AI Avatar Today

// ## Script

// Hi, this is Shiv, an AI avatar from Borade AI.

// You can book me for brand advertisements, events, promotional films, personalized greetings, and custom video messages.

// I look forward to working with you.

// ## Visual Enhancements

// - Subtle floating AI-inspired graphics
// - Elegant lower-third introduction
// - Smooth text animations
// - Soft cinematic lens flares
// - Premium blue-and-white brand accents
// - Minimal futuristic UI elements
// - Professional depth of field

// ## Ending

// The avatar smiles confidently.

// Display the Borade AI logo with the text:

// **Book Your AI Avatar Today**

// Fade out smoothly.

// **Duration:** 10–15 seconds.`,
//         ["https://d3szsaxquhat7n.cloudfront.net/prod/logo/BoradeLogo.png"],
//     );
//     console.log('result', result)

// }, 10000)


// setTimeout(async () => {
//     const result = await testLipsync({
//         video: { type: "url", url: "https://dr3bz8u3vjcki.cloudfront.net/test/videos/generate/veo-video/1785498397296.mp4" },
//         audio: { type: "url", url: "https://dr3bz8u3vjcki.cloudfront.net/test/temp/a2936065aa884a8fbfa930fbbb1175e5+(mp3cut.net).mp3" },
//         mode: "precision",
//         title: "Draft Resync Speed Test",
//         enable_caption: false,
//         enable_speech_enhancement: true,

//         poll: true,
//     });
//     console.log('result', result)
// }, 15000)