/**
 * HeyGen Automated Worker Pipeline Service
 * Manages background creation of Photo Avatar Clone, Voice Clone, Avatar Looks, and 15-Second Intro Video.
 */

import HeyGenClient, { VideoHelper } from "./HeyGen/index.js";
import HeyGenAvatar from "../../models/AiStudio/HeyGenAvatarModel.js";
import Avatar from "../../models/AiStudio/AvatarModel.js";
import CelebrityRegistration from "../../models/AiStudio/CelebrityRegistration.js";
import config from "../../config/config.js";
import logger from "../../config/logger.js";

const heygen = new HeyGenClient({
  apiKey: config.HEYGEN_API_KEY || process.env.HEYGEN_API_KEY,
});

export const avatarLooks = [
"Close-up avatar standing confidently in a modern executive office with a clean neutral background, subtle desk elements, soft professional lighting, shallow depth of field, landscape composition.",

"Close-up avatar sitting naturally in a premium corporate lounge with minimalist furniture, warm professional lighting, softly blurred background, landscape composition.",

"Close-up avatar standing beside a floor-to-ceiling window inside a modern office, subtle city view softly blurred in the background, balanced professional lighting, landscape composition.",

"Close-up avatar sitting in an executive chair inside a clean modern office, minimal background elements, soft cinematic professional lighting, landscape composition.",

"Close-up avatar standing inside a minimalist corporate workspace with neutral walls and subtle office décor, clean professional atmosphere, landscape composition.",

"Close-up avatar standing confidently in a premium business lobby with simple architectural details, softly blurred background, professional lighting, landscape composition.",

"Close-up avatar sitting beside a modern conference table in a clean executive meeting room, subtle professional background, soft diffused lighting, landscape composition.",

"Close-up avatar seated naturally at a professional workspace with a laptop and minimal desk elements subtly visible, clean office background, landscape composition.",

"Close-up avatar standing inside a premium creative studio with a clean neutral backdrop, subtle professional equipment softly blurred behind, studio lighting, landscape composition.",

"Close-up avatar sitting comfortably on a modern sofa inside an executive reception area, minimalist professional background, warm soft lighting, landscape composition.",

"Close-up avatar standing inside a modern corporate hallway with clean architectural lines and subtle depth, softly blurred background, professional lighting, landscape composition.",

"Close-up avatar standing beside a presentation screen inside a premium meeting room, clean corporate background with minimal visual distractions, landscape composition.",

"Close-up avatar seated in a modern armchair inside a professional library or executive study, subtle bookshelves softly blurred in the background, landscape composition.",

"Close-up avatar standing inside a clean fashion studio with minimalist shelving and subtle premium décor, soft professional lighting, landscape composition.",

"Close-up avatar sitting at a modern meeting table inside a premium corporate office, clean neutral interior, shallow depth of field, landscape composition.",

"Close-up avatar standing inside a professional conference room with subtle glass panels and minimalist furnishings, clean corporate lighting, landscape composition.",

"Close-up avatar sitting naturally in a premium business lounge with neutral furniture and minimal background details, professional cinematic lighting, landscape composition.",

"Close-up avatar standing inside a contemporary design studio with clean walls, subtle framed artwork, softly blurred professional background, landscape composition.",

"Close-up avatar sitting inside a modern professional café-style workspace with minimal furniture and clean interior design, softly blurred background, landscape composition.",

"Close-up avatar standing inside a minimalist product showroom with clean architectural lines and subtle premium details, professional lighting, landscape composition.",

"Close-up avatar standing confidently inside a professional photography studio with a clean seamless backdrop, subtle studio equipment, softbox lighting, landscape composition.",

"Close-up avatar sitting on a premium leather chair inside an executive office, subtle desk and shelving softly blurred behind, professional lighting, landscape composition.",

"Close-up avatar standing inside a modern business reception area with clean walls, subtle architectural lighting, minimal visual distractions, landscape composition.",

"Close-up avatar sitting naturally inside a bright corporate atrium with subtle glass architecture and minimal indoor greenery softly blurred behind, landscape composition.",

"Close-up avatar standing confidently inside a contemporary professional workspace with minimalist furniture, neutral background tones, soft cinematic lighting, landscape composition."
];


/**
 * Execute worker pipeline asynchronously
 */
export const runHeyGenPipeline = async ({ userId, avatarRecord, body = {}, options = {} }) => {
  const apiKey = config.HEYGEN_API_KEY || process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    logger.warn("HeyGen API key is missing. Skipping HeyGen automated worker pipeline.");
    return;
  }

  console.log('Avatar creation started')

  try {
    // 1. Fetch Celebrity Registration Profile
    const celebrity = await CelebrityRegistration.findOne({ userId }).lean();
    const celebrityName =
      celebrity?.profile?.stageName ||
      celebrity?.profile?.fullName ||
      `Celebrity_${userId.toString().slice(-4)}`;

    let gender = "male";
    if (celebrity?.profile?.gender) {
      const g = celebrity.profile.gender.toLowerCase();
      gender = g === "female" ? "female" : "male";
    }

    // 2. Initialize or find HeyGenAvatar DB record
    let heygenAvatar = await HeyGenAvatar.findOne({ userId });
    if (!heygenAvatar) {
      heygenAvatar = new HeyGenAvatar({
        userId,
        celebrityId: celebrity?._id || null,
        avatarId: avatarRecord?._id || null,
        celebrityProfile: {
          fullName: celebrity?.profile?.fullName || celebrityName,
          stageName: celebrity?.profile?.stageName || celebrityName,
          gender,
        },
        status: "PENDING",
        pipelineProgress: 5,
        currentStepMessage: "Starting HeyGen AI Avatar Pipeline...",
      });
      await heygenAvatar.save();
    } else {
      heygenAvatar.celebrityProfile = {
        fullName: celebrity?.profile?.fullName || celebrityName,
        stageName: celebrity?.profile?.stageName || celebrityName,
        gender,
      };
      heygenAvatar.status = "PENDING";
      heygenAvatar.pipelineProgress = 5;
      heygenAvatar.currentStepMessage = "Starting HeyGen AI Avatar Pipeline...";
      await heygenAvatar.save();
    }

    console.log(' Initialize or find HeyGenAvatar DB record')

    // Extract photo and voice URLs
    const photoImageUrl =
      avatarRecord?.images?.full_body?.url ||
      avatarRecord?.images?.fullBody?.url ||
      avatarRecord?.images?.front?.url;

    const audioUrl = avatarRecord?.audio?.url;

    const rawResponses = {};

    // ----------------------------------------------------
    // STEP 1: Create Photo Avatar Clone in HeyGen Engine
    // ----------------------------------------------------
    let avatarId = "";
    let groupId = "";

    if (photoImageUrl) {
      heygenAvatar.status = "CLONING_AVATAR";
      heygenAvatar.pipelineProgress = 20;
      heygenAvatar.currentStepMessage = "Cloning Photo Avatar in HeyGen AI engine...";
      await heygenAvatar.save();

      try {
        const photoAvatarResult = await heygen.avatar.createPhotoAvatar({
          imageUrl: photoImageUrl,
          name: `${celebrityName}_Avatar`,
          gender,
          motion_prompt: "gesturing naturally while speaking",
          expressiveness: "high",
        });

        console.log('photoAvatarResult', photoAvatarResult)

        rawResponses.photoAvatar = photoAvatarResult;
        avatarId =
          photoAvatarResult?.avatar_item?.id ||
          photoAvatarResult?.avatar_id ||
          photoAvatarResult?.id ||
          photoAvatarResult?.data?.avatar_id ||
          "";

        groupId = photoAvatarResult?.avatar_item?.group_id || "";

        heygenAvatar.heygen.clone = {
          avatar_id: avatarId,
          group_id: groupId,
          name: `${celebrityName}_Avatar`,
          status: "processing",
          type: "photo",
          gender,
          motion_prompt: `gesturing naturally while speaking`,
          expressiveness: "high",
          response: photoAvatarResult,
        };
        await heygenAvatar.save();

        if (avatarId) {
          console.log(`Photo Avatar ${avatarId} created with status 'processing'. Polling status until completed...`);
          try {
            const polledAvatar = await heygen.avatar.pollLook(avatarId, {
              intervalMs: 5000,
              timeoutMs: 180000,
            });
            rawResponses.avatarDetails = polledAvatar;
            if (heygenAvatar.heygen?.clone) {
              heygenAvatar.heygen.clone.status = "ready";
              await heygenAvatar.save();
            }
            console.log(`Photo Avatar ${avatarId} completed and ready.`);
          } catch (pErr) {
            logger.warn(`Photo avatar polling warning: ${pErr.message}`);
          }
        }
      } catch (err) {
        logger.error("Error creating Photo Avatar in pipeline:", err);
        heygenAvatar.failedReason = `Avatar Clone Warning: ${err.message}`;
      }
    }

    // ----------------------------------------------------
    // STEP 2: Create Instant Voice Clone in HeyGen Engine
    // ----------------------------------------------------
    let voiceId = "";
    if (audioUrl) {
      heygenAvatar.status = "CLONING_VOICE";
      heygenAvatar.pipelineProgress = 40;
      heygenAvatar.currentStepMessage = "Cloning Voice Sample in HeyGen engine...";
      await heygenAvatar.save();

      try {
        const voiceCloneResult = await heygen.voiceClone.createInstantClone({
          name: `Voice_${celebrityName}`,
          audioUrl,
        });

        console.log('voiceCloneResult', voiceCloneResult);

        rawResponses.voiceClone = voiceCloneResult;
        voiceId =
          voiceCloneResult?.voice_clone_id ||
          voiceCloneResult?.voice_id ||
          voiceCloneResult?.clone_id ||
          voiceCloneResult?.id ||
          voiceCloneResult?.data?.voice_id ||
          "";

        heygenAvatar.heygen.voice = {
          voice_id: voiceId,
          name: `Voice_${celebrityName}`,
          status: "processing",
          response: voiceCloneResult,
        };
        await heygenAvatar.save();

        if (voiceId) {
          console.log(`Voice Clone ${voiceId} created with status 'processing'. Polling status until completed...`);
          try {
            const polledVoice = await heygen.voiceClone.pollVoice(voiceId, {
              intervalMs: 4000,
              timeoutMs: 90000,
            });
            const readyVoiceId = polledVoice?.voice_id || polledVoice?.id || polledVoice?.data?.voice_id || voiceId;
            voiceId = readyVoiceId;
            if (heygenAvatar.heygen?.voice) {
              heygenAvatar.heygen.voice.voice_id = readyVoiceId;
              heygenAvatar.heygen.voice.status = "ready";
              await heygenAvatar.save();
            }
            console.log(`Voice Clone ${voiceId} completed and ready.`);
          } catch (pErr) {
            logger.warn(`Voice clone polling warning: ${pErr.message}`);
          }
        }
      } catch (err) {
        logger.error("Error creating Instant Voice Clone in pipeline:", err);
        heygenAvatar.failedReason = `${heygenAvatar.failedReason || ""} | Voice Clone Warning: ${err.message}`;
      }
    }

    // Sync Avatar training details in DB
    try {
      await Avatar.findOneAndUpdate(
        { userId },
        {
          "training.modelId": avatarId,
          "training.voiceId": voiceId,
          "training.completedAt": new Date(),
        }
      );
    } catch (e) {
      logger.warn("Could not update Avatar training fields:", e.message);
    }

    // ----------------------------------------------------
    // STEP 3: Create & Confirm Avatar Look with Random Prompt
    // ----------------------------------------------------
    let lookId = avatarId;
    heygenAvatar.status = "GENERATING_LOOK";
    heygenAvatar.pipelineProgress = 60;

    const randomPrompt = avatarLooks[Math.floor(Math.random() * avatarLooks.length)];
    heygenAvatar.currentStepMessage = `Creating Avatar Look with prompt: "${randomPrompt}"...`;
    await heygenAvatar.save();

    if (avatarId) {
      try {
        console.log(`Creating new Avatar Look using prompt: "${randomPrompt}" for avatarId: ${avatarId}`);
        const lookResult = await heygen.avatar.createLook({
          prompt: randomPrompt,
          avatar_id: avatarId,
          group_id: groupId,
          name: `${celebrityName} Look`,
          gender,
          motion_prompt: "gesturing naturally while speaking",
          expressiveness: "high",
        });

        console.log('lookResult', lookResult);
        rawResponses.createLook = lookResult;

        const createdLookId =
          lookResult?.avatar_item?.id ||
          lookResult?.look_id ||
          lookResult?.avatar_id ||
          lookResult?.id ||
          lookResult?.data?.look_id ||
          lookResult?.data?.avatar_id ||
          lookResult?.data?.id ||
          "";

        if (createdLookId) {
          lookId = createdLookId;
          console.log(`Avatar Look ${createdLookId} created with status 'processing'. Polling status until completed...`);
          try {
            const polledLook = await heygen.avatar.pollLook(createdLookId, {
              intervalMs: 5000,
              timeoutMs: 180000,
            });
            rawResponses.lookDetails = polledLook;
            const readyLookId =
              polledLook?.avatar_id ||
              polledLook?.look_id ||
              polledLook?.id ||
              polledLook?.data?.avatar_id ||
              createdLookId;

            lookId = readyLookId;
            heygenAvatar.heygen.looks = [
              {
                look_id: readyLookId,
                name: `${celebrityName} Look`,
                status: "ready",
                response: polledLook,
              },
            ];
            await heygenAvatar.save();
            console.log(`Avatar Look ${readyLookId} completed and ready.`);
          } catch (pErr) {
            logger.warn(`Avatar look polling warning: ${pErr.message}`);
          }
        } else {
          heygenAvatar.heygen.looks = [
            {
              look_id: avatarId,
              name: `${celebrityName} Default Look`,
              image_url: photoImageUrl,
              status: "ready",
              response: lookResult || rawResponses.avatarDetails || { avatar_id: avatarId },
            },
          ];
          await heygenAvatar.save();
        }
      } catch (err) {
        logger.error("Error creating Avatar Look in pipeline:", err);
        heygenAvatar.failedReason = `${heygenAvatar.failedReason || ""} | Look Creation Warning: ${err.message}`;
      }
    }

    // ----------------------------------------------------
    // STEP 4: Generate 15-Second Intro Video using Created Look & Voice
    // ----------------------------------------------------
    const introScript = `Hi, this is ${celebrityName}, an AI clone from Borade AI. You can book me for brand advertisements, events, promotional films, personalized greetings, and custom video messages.`;

    if (avatarId || voiceId) {
      heygenAvatar.status = "GENERATING_INTRO_VIDEO";
      heygenAvatar.pipelineProgress = 80;
      heygenAvatar.currentStepMessage = "Avatar & Voice ready. Waiting 30 seconds for HeyGen asset propagation before generating video...";
      await heygenAvatar.save();

      console.log("Avatar and Voice are ready. Waiting 30 seconds before triggering video generation...");
      await new Promise((resolve) => setTimeout(resolve, 30000));
      console.log("30-second delay finished. Triggering video generation now...");

      try {
        const engineOpt = options.engine || body.engine;
        const motionPromptOpt = heygenAvatar?.heygen?.clone?.motion_prompt || options.motionPrompt || options.motion_prompt || body.motionPrompt || body.motion_prompt;
        const expressivenessOpt = options.expressiveness || body.expressiveness || 'high';
        const DEFAULT_FALLBACK_VOICE_ID = "df54a052be30416e97ab3ff0f091986a";
        const primaryVoiceId = voiceId || DEFAULT_FALLBACK_VOICE_ID;

        let videoResult;
        try {
          const videoPayload = VideoHelper.buildVideoPayload({
            title: `Intro_${celebrityName}_${Date.now()}`,
            avatarId: lookId || avatarId,
            voiceId: primaryVoiceId,
            script: introScript,
            engine: engineOpt ? (typeof engineOpt === "object" ? engineOpt : { type: engineOpt }) : { type: "avatar_iv" },
            motionPrompt: motionPromptOpt,
            expressiveness: expressivenessOpt || "high",
            aspectRatio: "16:9",
            dimension: {
              width: 1280,
              height: 720,
            },
          });

          console.log('Generating Intro Video with payload:', videoPayload);
          videoResult = await heygen.video.generateVideo(videoPayload);
        } catch (videoErr) {
          const errText = (videoErr?.message || "").toLowerCase();
          logger.warn(`Primary video generation failed with voice ID '${primaryVoiceId}': ${videoErr.message}. Retrying with system fallback voice ID '${DEFAULT_FALLBACK_VOICE_ID}'...`);
          const fallbackPayload = VideoHelper.buildVideoPayload({
            title: `Intro_${celebrityName}_${Date.now()}`,
            avatarId: lookId || avatarId,
            voiceId: DEFAULT_FALLBACK_VOICE_ID,
            script: introScript,
            prompt: randomPrompt,
            engine: engineOpt ? (typeof engineOpt === "object" ? engineOpt : { type: engineOpt }) : { type: "avatar_iv" },
            motionPrompt: motionPromptOpt || randomPrompt,
            expressiveness: expressivenessOpt || "high",
            aspectRatio: "16:9",
            dimension: {
              width: 1280,
              height: 720,
            },
          });
          videoResult = await heygen.video.generateVideo(fallbackPayload);
        }
        rawResponses.videoGeneration = videoResult;

        const videoId =
          videoResult?.video_id ||
          videoResult?.id ||
          videoResult?.data?.video_id ||
          "";

        heygenAvatar.heygen.introVideo = {
          video_id: videoId,
          status: "processing",
          duration: 15,
          script: introScript,
          response: videoResult,
        };
        heygenAvatar.rawResponses = rawResponses;
        await heygenAvatar.save();

        // ----------------------------------------------------
        // STEP 5: Poll Video Generation Status until completed
        // ----------------------------------------------------
        if (videoId) {
          pollIntroVideoStatus({ userId, videoId });
        } else {
          heygenAvatar.status = "COMPLETED";
          heygenAvatar.pipelineProgress = 100;
          heygenAvatar.currentStepMessage = "AI Avatar Clone and Voice completed successfully!";
          await heygenAvatar.save();
        }
      } catch (err) {
        logger.error("Error generating Intro Video in pipeline:", err);
        heygenAvatar.status = "COMPLETED";
        heygenAvatar.pipelineProgress = 100;
        heygenAvatar.currentStepMessage = "Avatar & Voice created successfully (Intro Video queued).";
        heygenAvatar.rawResponses = rawResponses;
        await heygenAvatar.save();
      }
    } else {
      heygenAvatar.status = "COMPLETED";
      heygenAvatar.pipelineProgress = 100;
      heygenAvatar.currentStepMessage = "HeyGen integration completed.";
      heygenAvatar.rawResponses = rawResponses;
      await heygenAvatar.save();
    }
  } catch (pipelineErr) {
    logger.error("HeyGen Pipeline Worker overall failure:", pipelineErr);
    try {
      await HeyGenAvatar.findOneAndUpdate(
        { userId },
        {
          status: "FAILED",
          pipelineProgress: 100,
          currentStepMessage: "HeyGen Avatar Pipeline encountered an error.",
          failedReason: pipelineErr.message,
        }
      );
    } catch (e) {
      logger.error("Failed to set error status in HeyGenAvatar:", e);
    }
  }
};

/**
 * Helper to poll intro video generation status in background and save final video details to DB schema
 */
export const pollIntroVideoStatus = async ({ userId, heygenAvatarId, videoId }) => {
  let attempts = 0;
  const maxAttempts = 30; // 30 * 8s = 240 seconds max

  const filterQuery = heygenAvatarId ? { _id: heygenAvatarId } : { userId };

  const timer = setInterval(async () => {
    attempts++;
    try {
      const statusResult = await heygen.video.getStatus(videoId);
      const videoStatus = statusResult?.status?.toLowerCase() || statusResult?.video_status?.toLowerCase();
      const videoUrl = statusResult?.video_url || statusResult?.url || statusResult?.download_url;
      const thumbnailUrl = statusResult?.thumbnail_url || statusResult?.cover_url;

      if (videoStatus === "completed" || videoUrl) {
        clearInterval(timer);

        // 1. Update HeyGenAvatar Schema
        const updatedRecord = await HeyGenAvatar.findOneAndUpdate(
          filterQuery,
          {
            status: "COMPLETED",
            pipelineProgress: 100,
            currentStepMessage: "AI Avatar Clone, Voice & Video completed successfully!",
            "heygen.introVideo.status": "completed",
            "heygen.introVideo.video_url": videoUrl || "",
            "heygen.introVideo.thumbnail_url": thumbnailUrl || "",
            "heygen.introVideo.response": statusResult,
            "rawResponses.videoStatus": statusResult,
          },
          { new: true }
        );

        // 2. Update Avatar Schema (AvatarModel)
        const targetUserId = updatedRecord?.userId || userId;
        if (targetUserId) {
          await Avatar.findOneAndUpdate(
            { userId: targetUserId },
            {
              status: "READY_FOR_TRAINING",
              "training.completedAt": new Date(),
              ...(videoUrl ? { "introVideo": videoUrl } : {}),
            }
          );
        }

        logger.info(`Video generation polling completed successfully for videoId: ${videoId}`);
      } else if (videoStatus === "failed") {
        clearInterval(timer);
        await HeyGenAvatar.findOneAndUpdate(
          filterQuery,
          {
            status: "COMPLETED",
            pipelineProgress: 100,
            currentStepMessage: "AI Avatar Clone & Voice created (Video rendering failed).",
            "heygen.introVideo.status": "failed",
            "heygen.introVideo.response": statusResult,
            "rawResponses.videoStatus": statusResult,
          }
        );
      } else if (attempts >= maxAttempts) {
        clearInterval(timer);
        await HeyGenAvatar.findOneAndUpdate(
          filterQuery,
          {
            status: "COMPLETED",
            pipelineProgress: 100,
            currentStepMessage: "AI Avatar Clone & Voice ready (Video rendering timeout).",
          }
        );
      }
    } catch (err) {
      logger.warn(`Polling video status attempt ${attempts} error:`, err.message);
      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }
  }, 8000);
};

export default {
  runHeyGenPipeline,
  pollIntroVideoStatus,
};
