// workers/follow.worker.js
import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import UserFollow from "../../models/UserFollow.js";
import User from "../../models/userModel.js";



const worker = new Worker(
  "follow-queue",
  async (job) => {
    const { followerId, followingId } = job.data;

    // Always verify latest DB state (prevents stale jobs)
    const doc = await UserFollow.findOne({ followerId, followingId }).lean();
    if (!doc) return;

    if (job.name === "follow") {
      // ensure still following
      if (!doc) return;

      await Promise.all([
        User.updateOne(
          { _id: followingId },
          { $inc: { followersCount: 1 } }
        ),
        User.updateOne(
          { _id: followerId },
          { $inc: { followingCount: 1 } }
        ),
      ]);
    }

    if (job.name === "unfollow") {
      // ensure unfollowed
      if (doc) return;

      await Promise.all([
        User.updateOne(
          { _id: followingId },
          { $inc: { followersCount: -1 } }
        ),
        User.updateOne(
          { _id: followerId },
          { $inc: { followingCount: -1 } }
        ),
      ]);
    }
  },
  {
    connection: redisClient,
    concurrency: 20, // tune based on load
  }
);

worker.on("completed", (job) => {
  // optional logging
});

worker.on("failed", (job, err) => {
  console.error("Job failed:", job.id, err);
});