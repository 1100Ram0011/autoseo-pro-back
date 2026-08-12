import { Worker } from "bullmq";
import { generateBlogFromTitle } from "../../services/blog-generation.service.js";
import redisClient from "../../config/redis.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import { deductDynamicCredit } from "../../utils/creditTracker.js";
import Blog from "../../models/blog/Blog.model.js";
import { addPublishJob } from "./blogQueue.js";
import mongoose from "mongoose";

const worker = new Worker(
  "auto-blog",
  async (job) => {
    const { userId, selectedTitle, websiteUrl, analysis, platforms, configId } = job.data;

    console.log(`\n🤖 [AUTO-BLOG] Starting generation for ${userId} - Title: ${selectedTitle}`);

    const businessProfile = await BusinessSummaryProfile.findOne({
      userId: userId,
      isActive: true,
    });

    const rawAnalysis = businessProfile?.analysis;
    const LogoUrl =
      rawAnalysis?.branding_guidelines?.logo_url ||
      rawAnalysis?.brand_identity?.logo_url ||
      rawAnalysis?.business_overview?.logo_url ||
      null;

    const validLogoUrl =
      LogoUrl && typeof LogoUrl === "string" && LogoUrl.trim().startsWith("http")
        ? LogoUrl.trim()
        : null;

    // 1. Generate Blog Content
    const result = await generateBlogFromTitle(
      analysis,
      selectedTitle,
      websiteUrl,
      websiteUrl, // blogPageUrl
      validLogoUrl
    );

    if (!result || !result.blogResult) {
      throw new Error("Failed to generate blog content.");
    }

    const { content, tags, coverImageUrl, title } = result.blogResult;

    // 2. Deduct Credits
    const blogContentCost = Number(String(result.blogContentCost || 0).replace(/[^\d.-]/g, ""));
    const blogImageCost = Number(String(result.blogImageCost || 0).replace(/[^\d.-]/g, ""));
    const FinalAmount = blogContentCost + blogImageCost;

    try {
      await deductDynamicCredit({
        userId,
        featureKey: "blogGeneration",
        usageCount: 1,
        referenceId: new mongoose.Types.ObjectId(configId),
        creditAmount: Number(FinalAmount.toFixed(2)),
        serviceName: "Auto Blog Generation",
        referenceModel: "AutoBlogConfig",
        description: `Auto-Blog: "${selectedTitle}"`,
        idempotencyKey: `autoblog-${job.id}`,
        metadata: {
          mediaType: "Image + Blog Content",
          source: "auto-blog-generation",
        },
      });
      console.log(`✅ Credits deducted for auto-blog`);
    } catch (creditErr) {
      console.error(`❌ Credit deduction failed:`, creditErr.message);
      throw creditErr;
    }

    // 3. Save Blog to DB
    const blog = new Blog({
      title: title || selectedTitle,
      content,
      tags: typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : tags,
      coverImage: coverImageUrl,
      author: userId,
      status: "queued",
    });

    await blog.save();

    // 4. Send to Publish Queue
    await addPublishJob(blog, platforms);
    console.log(`✅ Auto-blog added to publish queue!`);

    return { success: true, blogId: blog._id };
  },
  {
    connection: redisClient,
    skipVersionCheck: true,
    lockDuration: 120000,
    concurrency: 2,
  }
);

worker.on("completed", (job) => console.log(`✅ Auto-blog job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`❌ Auto-blog job ${job?.id} failed: ${err.message}`));
worker.on("error", (err) => console.error("❌ Worker error:", err.message));

export default worker;
