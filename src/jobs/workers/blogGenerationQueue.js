import { Worker } from "bullmq";
import { generateBlogFromTitle } from "../../services/blog-generation.service.js";
import redisClient from "../../config/redis.js";
import BlogGenerationJob from "../../models/blog/BlogGenerationJob.model.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import {
  deductDynamicCredit,
  trackAndDeductFeatureCredit,
} from "../../utils/creditTracker.js";

// const worker = new Worker(
//   "blog-generation",
//   async (job) => {
//     const { userId, selectedTitle, websiteUrl, blogPageUrl } = job.data;

//     console.log("job.data.analysis type:", typeof job.data.analysis);
//     console.log(
//       "job.data.analysis preview:",
//       String(job.data.analysis).substring(0, 100),
//     );

//     // Update status to processing
//     await BlogGenerationJob.findOneAndUpdate(
//       { jobId: String(job.id) },
//       { status: "processing" },
//     ).catch(console.error);

//     const analysis =
//       typeof job.data.analysis === "string"
//         ? JSON.parse(job.data.analysis)
//         : job.data.analysis;

//     // ✅ await the DB query
//     const businessProfile = await BusinessSummaryProfile.findOne({
//       userId: userId,
//       isActive: true,
//     });

//     // ✅ Check multiple possible paths for logo URL
//     const rawAnalysis = businessProfile?.analysis;
//     const LogoUrl =
//       rawAnalysis?.branding_guidelines?.logo_url ||
//       rawAnalysis?.brand_identity?.logo_url ||
//       rawAnalysis?.business_overview?.logo_url ||
//       null;

//     console.log("🖼 Logo URL found:", LogoUrl ?? "none");

//     // ✅ Only pass if it's a fully valid URL (no 'undefined' in path)
//     // const validLogoUrl =
//     //   LogoUrl &&
//     //   typeof LogoUrl === "string" &&
//     //   LogoUrl.startsWith("http") &&
//     //   !LogoUrl.includes("undefined")
//     //     ? LogoUrl
//     //     : null;

//     // ✅ Updated Validation (Removed undefined check)
//     const validLogoUrl =
//       LogoUrl &&
//       typeof LogoUrl === "string" &&
//       LogoUrl.trim().startsWith("http")
//         ? LogoUrl.trim()
//         : null;

//     console.log(
//       "🖼 Valid Logo URL:",
//       validLogoUrl ?? "none — will skip overlay",
//     );

//     console.log(
//       "🖼 Valid Logo URL:",
//       validLogoUrl ?? "none — will skip overlay",
//     );

//     const result = await generateBlogFromTitle(
//       analysis,
//       selectedTitle,
//       websiteUrl,
//       blogPageUrl,
//       validLogoUrl,
//     );

//     // Save result permanently to DB
//     const BlogJob = await BlogGenerationJob.findOneAndUpdate(
//       { jobId: String(job.id) },
//       {
//         status: "completed",
//         result: result?.blogResult,
//         completedAt: new Date(),
//       },
//     ).catch(console.error);

//     if (result) {
//       // await trackAndDeductFeatureCredit({
//       //   userId: BlogJob?.userId,
//       //   featureKey: "blogGeneration",
//       //   usageCount: 1,
//       //   referenceId: BlogJob._id.toString(),
//       //   referenceModel: "blogGeneration",
//       //   description: `Blog generated: "${BlogJob.selectedTitle}"`,
//       //   metadata: {
//       //     title: BlogJob.selectedTitle,
//       //     referenceModel: "blogGeneration",
//       //   },
//       // });

//       const blogContentCost = Number(
//         String(result.blogContentCost || 0).replace(/[^\d.-]/g, ""),
//       );

//       const blogImageCost = Number(
//         String(result.blogImageCost || 0).replace(/[^\d.-]/g, ""),
//       );

//       console.log(blogContentCost);
//       console.log(blogImageCost);

//       const FinalAmount = blogContentCost + blogImageCost;
// console.log("========== BEFORE DEDUCTION ==========");
// console.log("Blog Content Cost:", blogContentCost);
// console.log("Blog Image Cost:", blogImageCost);
// console.log("Final Amount:", FinalAmount);
// console.log("User ID:", BlogJob?.userId);
// console.log("======================================");

//       console.log("FinalAmount", FinalAmount);

//       await deductDynamicCredit({
//         userId: BlogJob?.userId,
//         featureKey: "blogGeneration",
//         usageCount: 1,
//         referenceId: BlogJob._id,
//         creditAmount: Number(FinalAmount.toFixed(2)),
//         serviceName: "Blog Generation",
//         referenceModel: "blogGeneration",
//         description: `Blog Generation`,
//         idempotencyKey: `ai-${BlogJob?._id}-blog`,
//         metadata: {
//           referenceId: BlogJob._id,
//           referenceModel: "blogGeneration",
//           mediaType: "Image + Blog Content",
//           source: "blog-generation",
//         },
//       });
//     }

//     return { title: selectedTitle, ...result };
//   },
//   {
//     connection: redisClient,
//     skipVersionCheck: true,
//     lockDuration: 120000,
//   },
// );

const worker = new Worker(
  "blog-generation",
  async (job) => {
    const { userId, selectedTitle, websiteUrl, blogPageUrl } = job.data;

    console.log(`\n🎯 [BLOG ${job.id}] Starting generation...`);

    // ✅ Update status IMMEDIATELY (before processing starts)
    await BlogGenerationJob.findOneAndUpdate(
      { jobId: String(job.id) },
      { 
        status: "processing",
        updatedAt: new Date(),
      },
      { new: true }
    ).catch(console.error);

    const analysis =
      typeof job.data.analysis === "string"
        ? JSON.parse(job.data.analysis)
        : job.data.analysis;

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
      LogoUrl &&
      typeof LogoUrl === "string" &&
      LogoUrl.trim().startsWith("http")
        ? LogoUrl.trim()
        : null;

    console.log(`🎨 Logo URL: ${validLogoUrl ? "✅ Found" : "❌ None"}`);

    // ✅ This returns { blogContentCost, blogImageCost, blogResult }
    const result = await generateBlogFromTitle(
      analysis,
      selectedTitle,
      websiteUrl,
      blogPageUrl,
      validLogoUrl,
    );

    console.log(`\n💰 [COST BREAKDOWN]`);
    console.log(`   Text Cost  : ₹${result.blogContentCost}`);
    console.log(`   Image Cost : ₹${result.blogImageCost}`);
    console.log(`   Total      : ₹${(Number(result.blogContentCost) + Number(result.blogImageCost)).toFixed(2)}`);

    // ✅ Save to DB first
    const BlogJob = await BlogGenerationJob.findOneAndUpdate(
      { jobId: String(job.id) },
      {
        status: "completed",
        selectedTitle: result?.blogResult?.title || selectedTitle,
        result: result?.blogResult,
        completedAt: new Date(),
      },
      { new: true }
    ).catch(console.error);

    // ✅ Then deduct credits (after saving result)
    if (result && BlogJob) {
      const blogContentCost = Number(
        String(result.blogContentCost || 0).replace(/[^\d.-]/g, ""),
      );

      const blogImageCost = Number(
        String(result.blogImageCost || 0).replace(/[^\d.-]/g, ""),
      );

      const FinalAmount = blogContentCost + blogImageCost;

      console.log("\n========== CREDIT DEDUCTION ==========");
      console.log("Blog Content Cost:", blogContentCost);
      console.log("Blog Image Cost:", blogImageCost);
      console.log("Final Amount:", FinalAmount);
      console.log("User ID:", BlogJob?.userId);
      console.log("======================================\n");

      try {
        await deductDynamicCredit({
          userId: BlogJob?.userId,
          featureKey: "blogGeneration",
          usageCount: 1,
          referenceId: BlogJob._id,
          creditAmount: Number(FinalAmount.toFixed(2)),
          serviceName: "Blog Generation",
          referenceModel: "blogGeneration",
          description: `Blog: "${selectedTitle}"`,
          idempotencyKey: `ai-${BlogJob?._id}-blog`, // ✅ Prevents duplicate deductions
          metadata: {
            referenceId: BlogJob._id,
            referenceModel: "blogGeneration",
            mediaType: "Image + Blog Content",
            source: "blog-generation",
          },
        });
        console.log(`✅ Credits deducted for blog ${BlogJob._id}`);
      } catch (creditErr) {
        console.error(`❌ Credit deduction failed:`, creditErr.message);
        // ✅ Mark as failed if credit deduction fails
        await BlogGenerationJob.findOneAndUpdate(
          { jobId: String(job.id) },
          {
            status: "failed",
            errorMessage: `Credit deduction failed: ${creditErr.message}`,
          }
        );
        throw creditErr;
      }
    }

    return { title: result?.blogResult?.title || selectedTitle, ...result };
  },
  {
    connection: redisClient,
    skipVersionCheck: true,
    lockDuration: 120000,
    concurrency: 5, // ✅ CRITICAL: Only 1 job at a time (sequential generation)
  },
);

worker.on("completed", (job) =>
  console.log(`✅ Blog generation job ${job.id} completed`),
);

worker.on("failed", (job, err) => {
  console.error(`❌ Blog generation job ${job?.id} failed: ${err.message}`);
  BlogGenerationJob.findOneAndUpdate(
    { jobId: String(job?.id) },
    { status: "failed", errorMessage: err.message },
  ).catch(console.error);
});

worker.on("error", (err) => console.error("❌ Worker error:", err.message));

export default worker;
