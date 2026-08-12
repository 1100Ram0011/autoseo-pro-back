import { Worker } from "bullmq";
import axios from "axios";
import redisClient from "../../config/redis.js";
import Moderation from "../../models/Moderation.js";
import SwapTemplate from "../../models/SwapTemplate.js";
import pixverseVideoService from "../../utils/pixverseVideoService.js";
import path from "path";
import { URL } from "url";
import MediaStore from "../../models/MediaStore.js";
import { videoQueue } from "../index.js";
import { notifyNewPost } from "../../utils/notificationHelper.js";

const worker = new Worker(
  "moderation-queue",
  async (job) => {
    const {
      moderationId,
    } = job.data;
    try {
      console.log('Moderation worker started')
      const moderationRec = await Moderation.findById(moderationId)
      if (!moderationRec) {
        console.log('No moderation record found!')
        return
      }
      moderationRec.processingStatus = 'Processing'
      moderationRec.save()
      const { sourceContentType, sourceUrl, source, referenceId } = moderationRec
      try {
        const analyze = await axios.post('https://api.ai.mytek.in/moderation/analyze', { url: sourceUrl, contentType: sourceContentType })
        const { nudity, frames_analyzed, nudity_frame_url, final } = analyze.data
        moderationRec.moderationStatus = final
        if (final === 'Safe') {
          moderationRec.processingStatus = 'Completed'
        }
        else {
          moderationRec.processingStatus = 'Rejected'
          moderationRec.evidenceUrl = nudity_frame_url
        }

      } catch (error) {
        console.log('error in analyze', error)
        moderationRec.errorLog = error
        moderationRec.processingStatus = 'Failed'
      }

      moderationRec.save()
      if (source === 'FaceSwap') {
        const faceSwap = await SwapTemplate.findById(referenceId)
        // Upload to PixVerse (for SWAP)
        if (moderationRec.moderationStatus === 'Safe') {
          const { buffer, mimeType, originalName } = await fetchVideoAsBuffer(moderationRec?.sourceUrl)
          const uploaded = await pixverseVideoService.uploadVideoMedia(buffer, mimeType, process.env.PIXVERSE_API_KEY, originalName || ` swap template`,
          );
          faceSwap.videoUrl = uploaded?.url,
            faceSwap.pixverseVideoMediaId = uploaded.media_id
        }

        const wasUnderReview = Boolean(faceSwap.isUnderReview);

        faceSwap.isUnderReview = !['Completed', "Rejected"].includes(moderationRec?.processingStatus)
        faceSwap.isRejected = moderationRec.processingStatus === 'Rejected'
        faceSwap.isPublic = moderationRec.processingStatus === 'Completed' && moderationRec?.moderationStatus === "Safe"
        faceSwap.moderationId = moderationId
        await faceSwap.save()

        // 🚀 Trigger post upload notifications only when moderation completes successfully and isPublic becomes true
        if (wasUnderReview && !faceSwap.isUnderReview && faceSwap.isPublic) {
          notifyNewPost({
            ownerId: faceSwap.ownerId,
            postId: faceSwap._id,
            postModel: "SwapTemplate",
            title: faceSwap.title,
            videoUrl: faceSwap.videoUrl || faceSwap.sourceUrl,
          }).catch(err => console.error("Error triggering new post notifications on moderation approval:", err));
        }
      }

      if (source === 'MediaStore') {
        const mediaStore = await MediaStore.findById(referenceId)

        mediaStore.isUnderReview = !['Completed', "Rejected", 'Failed'].includes(moderationRec?.processingStatus)
        mediaStore.isRejected = moderationRec.processingStatus === 'Rejected'
        mediaStore.moderationId = moderationId
        mediaStore.save()
      }

      await videoQueue.add(
        "process-video",
        {
          mp4Url: moderationRec?.sourceUrl,
          sourceId: referenceId,
          sourceModel: 'SwapTemplate',
        },
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      )
    }
    catch (err) {
      console.error("Error processing face swap job:", err);
      throw err;
    }
  },
  {
    connection: redisClient,
    concurrency: 2,
  },
)

worker.on("completed", (job) => console.log(`✅ Moderation Job completed: ${job.id}`));
worker.on("failed", (job, err) =>
  console.error(`❌ Moderation Job failed: ${job.id}`, err.message),
);

export default worker;


export async function fetchVideoAsBuffer(videoUrl) {
  const response = await axios.get(videoUrl, {
    responseType: "arraybuffer",
  });

  // ✅ Buffer
  const buffer = Buffer.from(response.data);

  // ✅ MIME type (from headers)
  const mimeType = response.headers["content-type"] || "application/octet-stream";

  // ✅ original filename
  let originalName = "file";

  // Try from Content-Disposition header
  const disposition = response.headers["content-disposition"];
  if (disposition) {
    const match = disposition.match(/filename="?(.+?)"?$/);
    if (match) originalName = match[1];
  } else {
    // fallback: extract from URL
    const parsedUrl = new URL(videoUrl);
    originalName = path.basename(parsedUrl.pathname) || "file";
  }

  return {
    buffer,
    mimeType,
    originalName,
  };
}