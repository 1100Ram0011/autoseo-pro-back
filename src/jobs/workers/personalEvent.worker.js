import agenda from "../agenda.js";
import PersonalEvent from "../../models/PersonalEvent.js";
import SocialPost from "../../models/SocialPost.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import { generateNanoBanana } from "../../services/imageGeneration.js";
import { generateVideo } from "../../services/videoGeneration.js";
import { uploadBase64ToS3, uploadBase64VideoToS3 } from "../../services/s3.js";
import { overlayLogoSimple } from "../../services/imageOverlay.js";
import MediaStore from "../../models/MediaStore.js";

/* ─────────────────────────────────────────────
   DEFINE JOB
───────────────────────────────────────────── */

agenda.define("PERSONAL_EVENT_DAILY_CHECK", async (job) => {
  const now = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const thisYear = now.getFullYear();

  console.log(
    `[PersonalEvent] Running daily check for ${todayMonth}/${todayDay}/${thisYear}`,
  );

  // Find all recurring events that fire today and haven't been generated this year
  const events = await PersonalEvent.find({
    isRecurring: true,
    isActive: true,
    month: todayMonth,
    day: todayDay,
    $or: [
      { lastGeneratedYear: { $lt: thisYear } },
      { lastGeneratedYear: null },
    ],
  }).lean();

  if (!events.length) {
    console.log("[PersonalEvent] No recurring events to process today.");
    return;
  }

  console.log(`[PersonalEvent] Found ${events.length} event(s) to generate.`);

  for (const event of events) {
    try {
      await scheduleRecurringPost(event, thisYear);
    } catch (err) {
      console.error(
        `[PersonalEvent] Failed for event ${event._id}:`,
        err.message,
      );
    }
  }
});

/* ─────────────────────────────────────────────
   SCHEDULE THE RECURRING POST
───────────────────────────────────────────── */

async function scheduleRecurringPost(event, year) {
  const userId = event.userId;

  // Build the scheduled datetime for this year
  const [hours, minutes] = (event.scheduledTime || "10:00")
    .split(":")
    .map(Number);
  const scheduledDateTime = new Date(
    year,
    event.month - 1,
    event.day,
    hours,
    minutes,
    0,
    0,
  );

  // If the time is already past today, schedule for a few minutes from now
  const fireAt =
    scheduledDateTime > new Date()
      ? scheduledDateTime
      : new Date(Date.now() + 5 * 60 * 1000);

  const caption = `Happy ${event.name}! ${event.emoji || "✨"}`;

  // Create placeholder post
  const posts = event.platforms.map((p) => ({
    platform: p.platform,
    accountId: p.accountId,
    media: [
      {
        type: (event.contentType || "image").toLowerCase(),
        url: "processing",
      },
    ],
    caption: caption,
    hashtags: [`#${event.name.replace(/\s+/g, "")}`, "#celebration"],
    status: "PROCESSING",
    postType: p.postType || "FEED",
    boardId: p.boardId,
  }));

  const socialPost = await SocialPost.create({
    userId,
    festivalName: event.name,
    posts,
    publishType: "SCHEDULED",
    scheduledAt: fireAt,
    status: "PROCESSING",
  });

  // Mark this year as generated immediately so a crash-restart doesn't double-fire
  await PersonalEvent.findByIdAndUpdate(event._id, {
    $push: { posts: socialPost._id },
    lastGeneratedYear: year,
  });

  // Fetch business data for branding
  const profile = await BusinessSummaryProfile.findOne({
    userId,
    status: "COMPLETED",
    isActive: true,
  }).lean();
  let businessData = {};
  if (profile?.analysis) {
    const a = profile.analysis;
    businessData = {
      primaryColor: a?.branding_guidelines?.brand_colors?.[0] || null,
      logo: a?.branding_guidelines?.logo_url || null,
    };
  }

  // Background generate (same pipeline as on-demand creation)
  generateAndPublish(socialPost._id, {
    eventName: event.name,
    eventType: event.eventType,
    contentType: event.contentType || "image",
    prompt: event.prompt,
    businessData,
    userId,
    scheduledDateTime: fireAt,
    emoji: event.emoji || "✨",
  });

  console.log(
    `[PersonalEvent] Queued post ${socialPost._id} for "${event.name}" (${event.userId})`,
  );
}

/* ─────────────────────────────────────────────
   GENERATION PIPELINE (mirrors festival controller)
───────────────────────────────────────────── */

async function generateAndPublish(postId, data) {
  try {
    const {
      eventName,
      eventType,
      contentType,
      prompt,
      businessData,
      userId,
      scheduledDateTime,
      emoji,
    } = data;

    const enhancedPrompt = buildPrompt(
      eventName,
      eventType,
      prompt,
      businessData,
      contentType,
    );

    let mediaUrl;

    if (contentType === "image") {
      const combinedAttachments = businessData?.logo ? [{ path: businessData.logo }] : [];
      const result = await generateNanoBanana(
        enhancedPrompt,
        { ratio: "1:1", model: "gemini-2.5-flash-image" },
        userId,
        combinedAttachments
      );
      if (result?.success && result?.imageBase64) {
        mediaUrl = await uploadBase64ToS3(result.imageBase64);
      }
    } else {
      const result = await generateVideo(enhancedPrompt, null, null, {
        aspect: "16:9",
        quality: "1080p",
        duration: 8,
      });
      if (result?.success && result?.videoBase64) {
        mediaUrl = await uploadBase64VideoToS3(result.videoBase64);
      }
    }

    if (!mediaUrl) throw new Error("Media generation returned no URL");

    await MediaStore.create({
      userId,
      mediaUrl,
      mediaType: contentType,
      description: `${eventName} recurring annual post`,
      hashtags: [`#${eventName.replace(/\s+/g, "")}`, "#celebration"],
      source: "ai",
      uploadType: "ai",
      uploadedAt: new Date(),
      publishedPlatforms: [],
      isArchived: false,
      isMediaDeleted: false,
      isUserDeleted: false,
      isUnderReview: false,
    });

    const caption = `Happy ${eventName}! ${emoji}`;

    const postToUpdate = await SocialPost.findById(postId);
    if (postToUpdate) {
      postToUpdate.publishType = "SCHEDULED";
      postToUpdate.scheduledAt = scheduledDateTime;
      postToUpdate.status = "SCHEDULED";
      if (postToUpdate.posts) {
        postToUpdate.posts.forEach((p) => {
          p.caption = caption;
          p.status = "SCHEDULED";
          if (p.media && p.media.length > 0) {
            p.media[0].url = mediaUrl;
          }
        });
      }
      await postToUpdate.save();
    }

    if (postToUpdate && postToUpdate.posts && postToUpdate.posts.length > 0) {
      for (const p of postToUpdate.posts) {
        await agenda.schedule(
          new Date(p.scheduledAt || scheduledDateTime),
          "SOCIAL_PUBLISH_POST",
          {
            postId,
            postItemId: p._id.toString(),
          },
        );
      }
    } else {
      await agenda.schedule(
        new Date(scheduledDateTime),
        "SOCIAL_PUBLISH_POST",
        {
          postId,
        },
      );
    }

    console.log(`[PersonalEvent] ✅ Post ready: ${postId}`);
  } catch (err) {
    console.error(`[PersonalEvent] ❌ Generation failed: ${postId}`, err);
    const failedPost = await SocialPost.findById(postId);
    if (failedPost) {
      failedPost.status = "FAILED";
      if (failedPost.posts) {
        failedPost.posts.forEach((p) => {
          p.status = "FAILED";
        });
      }
      await failedPost.save();
    }
  }
}

function buildPrompt(
  eventName,
  eventType,
  customPrompt,
  businessData,
  contentType,
) {
  const base = customPrompt?.trim() || defaultBasePrompt(eventType, eventName);
  const colorHint = businessData?.primaryColor
    ? `Subtly incorporate ${businessData.primaryColor} as an accent color.`
    : "";
  return `${base}\n\nEvent: ${eventName}\n\nTEXT IS MANDATORY: "${eventName}"\n\n${colorHint}\n\nStyle: elegant, cinematic lighting.\nAspect ratio: ${contentType === "video" ? "16:9" : "9:16"}`.trim();
}

function defaultBasePrompt(eventType, eventName) {
  const map = {
    birthday: `Warm, vibrant birthday celebration for "${eventName}" — balloons, cake, confetti.`,
    anniversary: `Romantic anniversary post for "${eventName}" — soft florals, hearts, golden accents.`,
    corporate_anniversary: `Professional corporate milestone for "${eventName}" — clean, polished, brand-aligned.`,
    rip: `Solemn remembrance post for "${eventName}" — candles, peaceful imagery, dignified.`,
  };
  return (
    map[eventType] ||
    `Beautiful celebration post for "${eventName}". Elegant and memorable.`
  );
}

/* ─────────────────────────────────────────────
   SCHEDULE THE CRON — runs every day at 00:05
───────────────────────────────────────────── */

export const startPersonalEventScheduler = async () => {
  await agenda.every("0 5 0 * * *", "PERSONAL_EVENT_DAILY_CHECK"); // 00:05 daily (cron)
  console.log("[PersonalEvent] Recurring scheduler registered ✅");
};
