// import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";
// import { generateImage, generateVideo } from "./aiService.js";
// import { buildClaudeVideoPrompt } from "../utils/buildClaudeVideoPrompt.js";
// import { buildImagePrompt } from "../utils/buildImagePrompt.js";
// import { uploadBase64ToS3 } from "../utils/uploadBase64ToS3.js";
// import { runClaudePostContentGeneration } from "./claude.service.js";

// export async function runVideoContentGeneration(userId, websiteHash) {
//     const record = await BusinessSummaryProfile.findOne({
//         userId,
//         websiteHash,
//         status: "COMPLETED",
//     });

//     if (!record?.analysis) {
//         throw new Error("Completed analysis not found");
//     }

//     const analysis = record.analysis;
//     const videos = analysis?.video_content?.videos ?? [];

//     if (!videos.length) return [];

//     const businessContext = {
//         brand_name: analysis?.business_overview?.brand_name,
//         legal_name: analysis?.business_overview?.legal_name,
//         industry: analysis?.business_overview?.industries,
//         business_type: analysis?.business_overview?.business_type,
//         target_audience: {
//             primary_segments:
//                 analysis?.target_market?.primary_customer_segments,
//             decision_makers:
//                 analysis?.target_market?.decision_makers,
//             ideal_profiles:
//                 analysis?.target_market?.ideal_client_profiles,
//         },
//         competitive_positioning:
//             analysis?.competitor_analysis?.competitive_positioning_summary,
//         branding_guidelines: {
//             colors: analysis?.branding_guidelines?.brand_colors,
//             fonts: analysis?.branding_guidelines?.fonts,
//             visual_style: analysis?.branding_guidelines?.visual_style,
//         },
//     };

//     const generatedVideos = [];
//     for (let i = 0; i < videos.length; i++) {
//         const video = videos[i]

//         const prompt = buildClaudeVideoPrompt(video, businessContext)
//         const veoResult = await generateVideo(prompt, userId)

//         generatedVideos.push({
//             videoUrl: veoResult.videoUrl,
//             description: analysis?.video_content?.videos?.[i]?.objective,
//             hashtags: analysis?.video_content?.videos?.[i]?.hashtags
//         })
//     }

//     console.log("generatedVideos", generatedVideos);

//     return generatedVideos;
// }

// export async function runImageContentGeneration(userId, websiteHash) {
//     const record = await BusinessSummaryProfile.findOne({
//         userId,
//         websiteHash,
//         status: "COMPLETED",
//     });

//     if (!record?.analysis) {
//         throw new Error("Completed analysis not found");
//     }

//     const analysis = record.analysis;
//     const images = analysis?.image_content?.images ?? [];

//     if (!images.length) return [];

//     /* -----------------------------
//        BUSINESS CONTEXT
//     ----------------------------- */
//     const businessContext = {
//         brand_name: analysis?.business_overview?.brand_name,
//         legal_name: analysis?.business_overview?.legal_name,
//         industry: analysis?.business_overview?.industries,
//         business_type: analysis?.business_overview?.business_type,
//         target_audience: {
//             primary_segments:
//                 analysis?.target_market?.primary_customer_segments,
//             decision_makers:
//                 analysis?.target_market?.decision_makers,
//             ideal_profiles:
//                 analysis?.target_market?.ideal_client_profiles,
//         },
//         competitive_positioning:
//             analysis?.competitor_analysis?.competitive_positioning_summary,
//         branding_guidelines: {
//             colors: analysis?.branding_guidelines?.brand_colors,
//             fonts: analysis?.branding_guidelines?.fonts,
//             visual_style: analysis?.branding_guidelines?.visual_style,
//         },
//     };

//     /* -----------------------------
//        IMAGE GENERATION
//     ----------------------------- */
//     const generatedImages = [];

//     for (let i = 0; i < images.length; i++) {
//         const image = images[i]

//         const prompt = buildImagePrompt(image, businessContext)

//         const imageResult = await generateImage(prompt, userId)
//         const mediaUrl = await uploadBase64ToS3(imageResult.imageBase64)

//         const metadata = {
//             mimeType: imageResult.mimeType || "image/jpeg",
//         }

//         const ContentHashtagsRes = await runClaudePostContentGeneration({ userPrompt: prompt, mediaType: "image" })

//         generatedImages.push({
//             mediaUrl,
//             description: ContentHashtagsRes?.description,
//             hashtags: ContentHashtagsRes.hashtags
//         })
//     }

//     console.log("generatedImages - ", generatedImages)

//     return generatedImages;
// }

import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";
import {
  composeImage,
  generateImage,
  generateImagePrompt,
  generateNanoBanana,
  generateOvelay,
  generateVideo,
  processBusinessBranding,
} from "./aiService.js";
import { buildClaudeVideoPrompt, buildUniversalVideoPrompt } from "../utils/buildClaudeVideoPrompt.js";
import { buildImagePrompt } from "../utils/buildImagePrompt.js";
import { uploadBase64ToS3 } from "../utils/uploadBase64ToS3.js";
import { runClaudePostContentGeneration } from "./claude.service.js";
import IndividualAnalysisSchema from "../models/IndividualAnalysisProfile.js";
import { compositeLogoOnFirstFrame } from "../utils/imageCompositor.js";
import { stripCrMetadata } from "../utils/stripCrMetadata.js";
import AdminOutreachProfile from "../models/AdminOutreachProfile.js";
import config from "../config/config.js";

// export async function runVideoContentGeneration(userId, websiteHash) {
//   const record = await BusinessSummaryProfile.findOne({
//     userId,
//     websiteHash,
//     status: "COMPLETED",
//     isActive: true,
//   });

//   const IndividualProfile = await IndividualAnalysisSchema.findOne({
//     userId,
//     analysisStatus: "completed",
//     isActive: true,
//   }).sort({ createdAt: -1 });

//   if (!record?.analysis) {
//     throw new Error("Completed analysis not found");
//   }

//   const analysis = record.analysis;
//   const videos = analysis?.video_content?.videos ?? [];

//   if (!videos.length) return [];

//   const businessContext = {
//     brand_name: analysis?.business_overview?.brand_name,
//     legal_name: analysis?.business_overview?.legal_name,
//     industry: analysis?.business_overview?.industries?.join(", "),
//     business_type: analysis?.business_overview?.business_type,
//     target_audience: {
//       primary_segments: analysis?.target_market?.primary_customer_segments,
//       decision_makers: analysis?.target_market?.decision_makers,
//       ideal_profiles: analysis?.target_market?.ideal_client_profiles,
//     },
//     competitive_positioning:
//       analysis?.competitor_analysis?.competitive_positioning_summary,

//     brand_colors: {
//       primary: analysis?.branding_guidelines?.brand_colors?.[0] || "#000000",
//       secondary: analysis?.branding_guidelines?.brand_colors?.[1] || "#ffffff",
//     },

//     branding_guidelines: {
//       colors: analysis?.branding_guidelines?.brand_colors || [],
//       fonts: analysis?.branding_guidelines?.fonts || [],
//       visual_style: analysis?.branding_guidelines?.visual_style || "",
//       logo_url: analysis?.branding_guidelines?.logo_url || "",

//       // ✅ NEW — pulled from contact_info
//       website_url: analysis?.contact_info?.website || "",
//     },
//   };

//   let contactLines = [];
//   if (record?.analysis?.contact_info) {
//     const { website, phone, email, address } = record.analysis.contact_info;
//     // Order matters! This determines how they stack on the video
//     if (website) contactLines.push(website);
//     if (phone) contactLines.push(phone);
//     if (email) contactLines.push(email);
//     if (address) contactLines.push(address);
//   } else if (IndividualProfile?.analysisResult?.contact_and_social) {
//     // Add individual social/contact links if Business Profile doesn't exist
//     const social = IndividualProfile.analysisResult.contact_and_social;
//     if (social.website) contactLines.push(social.website);
//     if (social.twitter) contactLines.push(social.twitter);
//   }

//   const businessAttachments = [];
//   const individualAttachments = [];

//   // Attach logo
//   if (record?.analysis?.branding_guidelines?.logo_url) {
//     businessAttachments.push({
//       path: record.analysis.branding_guidelines.logo_url,
//     });
//   }

//   // Attach favicon
//   if (record?.analysis?.branding_guidelines?.favicon_url) {
//     businessAttachments.push({
//       path: record.analysis.branding_guidelines.favicon_url,
//     });
//   }

//   // Attach logo
//   if (
//     IndividualProfile?.analysisStatus === "completed" &&
//     IndividualProfile?.logoUrl
//   ) {
//     individualAttachments.push({
//       path: IndividualProfile.logoUrl,
//     });
//   }

//   // Attach favicon
//   if (
//     IndividualProfile?.analysisStatus === "completed" &&
//     IndividualProfile?.photoUrl
//   ) {
//     individualAttachments.push({
//       path: IndividualProfile.photoUrl,
//     });
//   }

//   // const draftAttachments = draftMessage.attachments || [];

//   const combinedAttachments = [
//     // ...draftAttachments,
//     ...businessAttachments,
//     ...individualAttachments,
//   ];

//   // Grab the primary logo from the attachments array
//   const logoAttachment =
//     combinedAttachments.length > 0 ? combinedAttachments[0].path : null;

//   console.log("businessContext", businessContext);
//   console.log("videos", videos);
//   console.log("analysis", analysis);

//   // 3. Inject logoUrl into params so the pollVeoOperation triggers FFmpeg outro
//   const currentParams = {
//     logoUrl: logoAttachment,
//     contactLines: contactLines,
//   };

//   let firstFrameUrl = null;
//   let finalFirstFrameBase64 = null;
//   const generatedVideos = [];
//   for (let i = 0; i < videos.length; i++) {
//     const video = videos[i];
//     const prompt = buildClaudeVideoPrompt(video, businessContext);

//     console.log('the prompt', prompt)

//     // 1. Parse prompt tags for cleaner Veo and Imagen instructions
//     // This will safely grab everything after [VISUAL] until [AUDIO] hits
//     const visualMatch = prompt.match(/\[VISUAL\]([\s\S]*?)(?:\[AUDIO\]|$)/i);
//     // This will grab everything after [AUDIO] to the end of the string
//     const audioMatch = prompt.match(/\[AUDIO\]([\s\S]*?)$/i);

//     const visualPrompt = visualMatch ? visualMatch[1].trim() : prompt;
//     const audioPrompt = audioMatch ? audioMatch[1].trim() : "";

//     if (logoAttachment) {
//       // Generate the background scene using Imagen 4
//       const imagenResult = await generateImage(visualPrompt, {
//         aspect: "9:16",
//       });

//       if (imagenResult?.success && imagenResult?.imageBase64) {
//         // Save clean background as a thumbnail before stamping
//         firstFrameUrl = await uploadBase64ToS3(imagenResult.imageBase64, config.AWS_S3_GENERATE_ORIGINAL_FOLDER);

//         // Stamp the logo onto the generated background using dynamic placement
//         finalFirstFrameBase64 = await compositeLogoOnFirstFrame(
//           imagenResult.imageBase64,
//           logoAttachment,
//         );
//       }
//     }

//     // 2. Format the Veo 3 prompt cleanly so it recognizes the audio request
//     const veoPrompt = audioPrompt
//       ? `${visualPrompt}\n\nAudio track: ${audioPrompt}`
//       : visualPrompt;

//     const veoResult = await generateVideo(
//       veoPrompt,
//       userId,
//       finalFirstFrameBase64,
//       currentParams,
//       null,
//       null,
//     );

//     generatedVideos.push({
//       videoUrl: veoResult.videoUrl,
//       description: video?.objective,
//       hashtags: video?.hashtags,
//       imageThumbnailUrl: firstFrameUrl,
//     });
//   }

//   console.log("generatedVideos", generatedVideos);

//   return generatedVideos;
// }

// export async function runImageContentGeneration(userId, websiteHash) {
//   console.log('Image generation started-----')
//   const record = await BusinessSummaryProfile.findOne({
//     userId,
//     websiteHash,
//     status: "COMPLETED",
//   });

//   if (!record?.analysis) {
//     throw new Error("Completed analysis not found");
//   }

//   const analysis = record.analysis;
//   const images = analysis?.image_content?.images ?? [];
//   const brandData = record
//   const brandProfile = {
//     aiInsights: {
//       summary: brandData?.analysisSummary
//     },
//     company: {
//       name: brandData?.analysis?.business_overview?.brand_name,
//       logo: brandData?.analysis?.branding_guidelines?.logo_url
//     },
//     visualIdentity: {
//       designStyle: brandData?.analysis?.branding_guidelines?.visual_style,
//       colors: brandData?.analysis?.branding_guidelines?.brand_colors
//     },

//   }

//   // console.log('brandProfile', brandProfile)

//   if (!images.length) return [];

//   /* -----------------------------
//        BUSINESS CONTEXT
//     ----------------------------- */
//   const businessContext = {
//     brand_name: analysis?.business_overview?.brand_name,
//     legal_name: analysis?.business_overview?.legal_name,
//     industry: analysis?.business_overview?.industries,
//     business_type: analysis?.business_overview?.business_type,
//     target_audience: {
//       primary_segments: analysis?.target_market?.primary_customer_segments,
//       decision_makers: analysis?.target_market?.decision_makers,
//       ideal_profiles: analysis?.target_market?.ideal_client_profiles,
//     },
//     competitive_positioning:
//       analysis?.competitor_analysis?.competitive_positioning_summary,
//     branding_guidelines: {
//       colors: analysis?.branding_guidelines?.brand_colors,
//       fonts: analysis?.branding_guidelines?.fonts,
//       visual_style: analysis?.branding_guidelines?.visual_style,
//       logo_url: analysis?.branding_guidelines?.logo_url,
//     },
//   };

//   /* -----------------------------
//        IMAGE GENERATION
//     ----------------------------- */
//   const generatedImages = [];

//   for (let i = 0; i < images.length; i++) {
//     const image = images[i];

//     // const prompt = buildImagePrompt(image, businessContext);

//     const promptGenerationResult = await generateImagePrompt({ scene: image?.objective, brandProfile: record })
//     const text = promptGenerationResult.data.content
//       .filter((b) => b.type === "text")
//       .map((b) => b.text)
//       .join("")
//       .replace(/```json|```/gi, "")
//       .trim();
//     const parsed = JSON.parse(text);
//     const prompt = parsed.final_prompt

//     const imageResult = await generateImage(prompt, userId);
//     const backgroundImage = await uploadBase64ToS3(imageResult.imageBase64);
//     console.log('backgroundImage', backgroundImage)

//     const finalFirstFrameBase64 = await generateOvelay({ brandProfile, backgroundImage, scene: prompt, userPrompt: image?.objective, })
//     const mediaUrl = await uploadBase64ToS3(finalFirstFrameBase64);
//     console.log('mediaUrl', mediaUrl)

//     const metadata = {
//       mimeType: imageResult.mimeType || "image/jpeg",
//     };

//     const ContentHashtagsRes = await runClaudePostContentGeneration({
//       userPrompt: prompt,
//       mediaType: "image",
//       businessContext,
//       websiteUrl: analysis?.websiteUrl

//     });

//     generatedImages.push({
//       mediaUrl,
//       description: ContentHashtagsRes?.description,
//       hashtags: ContentHashtagsRes.hashtags,
//       imageThumbnailUrl: backgroundImage
//     });
//   }

//   // console.log("generatedImages - ", generatedImages);

//   return generatedImages;
// }

export async function runVideoContentGeneration(userId, websiteHash) {
  const record = await BusinessSummaryProfile.findOne({
    userId,
    websiteHash,
    status: "COMPLETED",
    isActive: true,
  });

  const individualProfile = await IndividualAnalysisSchema.findOne({
    userId,
    analysisStatus: "completed",
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!record?.analysis) {
    throw new Error("Completed business analysis not found.");
  }

  const analysis = record.analysis;
  const videos = analysis?.video_content?.videos || [];

  if (!videos.length) {
    return [];
  }

  const attachments = [];
  const characterImages = []

  // Business Logo
  if (analysis?.branding_guidelines?.logo_url) {
    attachments.push({
      type: "brand_logo",
      path: analysis.branding_guidelines.logo_url,
    });
    characterImages.push(analysis.branding_guidelines.logo_url)
  }

  // Business Favicon
  if (analysis?.branding_guidelines?.favicon_url) {
    attachments.push({
      type: "favicon",
      path: analysis.branding_guidelines.favicon_url,
    });
  }

  // Individual Logo
  if (individualProfile?.logoUrl) {
    attachments.push({
      type: "personal_logo",
      path: individualProfile.logoUrl,
    });
  }

  // Individual Photo
  if (individualProfile?.photoUrl) {
    attachments.push({
      type: "person_reference",
      path: individualProfile.photoUrl,
    });
  }

  const contact = analysis?.contact_info || {};

  const contactLines = [];

  if (contact.website) contactLines.push(contact.website);
  if (contact.phone) contactLines.push(contact.phone);
  if (contact.email) contactLines.push(contact.email);
  if (contact.address) contactLines.push(contact.address);



  const generatedVideos = [];

  for (const video of videos) {

    const prompt = buildUniversalVideoPrompt({
      analysis,
      video,
      attachments,
      options: {
        duration: video.ideal_duration_seconds || 8,
        aspectRatio: "9:16",
        resolution: "1080x1920",
        fps: 30,
        includeLogo: false,
        includeBrandOutro: false,
        includeContact: false,
      },
    });

    // console.log("Universal Prompt");
    // console.log(prompt);

    const result = await generateVideo(
      prompt,
      userId,
      null,
      { characterImages, engine: 'omni-flash', logoUrl: characterImages[0], contactLines },
      null,
      null,
      false,
      true
    );

    generatedVideos.push({
      description: video.objective,
      hashtags: video.hashtags || [],
      prompt,
      videoUrl: result.videoUrl,
      thumbnailUrl: result.thumbnailUrl || null,
      duration: video.ideal_duration_seconds || 8,
    });
  }

  return generatedVideos;
}

export async function runImageContentGeneration(
  userId,
  websiteHash,
  isAdminOutreach = false,
) {
  let record;
  if (isAdminOutreach) {
    record = await AdminOutreachProfile.findOne({
      adminId: userId,
      websiteHash,
    }).populate("businessSummaryProfileId");
  } else {
    record = await BusinessSummaryProfile.findOne({
      userId,
      websiteHash,
      status: "COMPLETED",
      isActive: true,
    });
  }

  const analysis = isAdminOutreach
    ? record?.analysis || record?.businessSummaryProfileId?.analysis
    : record?.analysis;

  if (!analysis) {
    throw new Error("Completed analysis not found");
  }

  // analysis already defined above
  const images = analysis?.image_content?.images ?? [];

  if (!images.length) return [];

  /* -----------------------------
     BUSINESS CONTEXT
  ----------------------------- */
  const businessContext = {
    brand_name: analysis?.business_overview?.brand_name,
    legal_name: analysis?.business_overview?.legal_name,
    industry: analysis?.business_overview?.industries,
    business_type: analysis?.business_overview?.business_type,
    target_audience: {
      primary_segments: analysis?.target_market?.primary_customer_segments,
      decision_makers: analysis?.target_market?.decision_makers,
      ideal_profiles: analysis?.target_market?.ideal_client_profiles,
    },
    competitive_positioning:
      analysis?.competitor_analysis?.competitive_positioning_summary,
    branding_guidelines: {
      colors: analysis?.branding_guidelines?.brand_colors,
      fonts: analysis?.branding_guidelines?.fonts,
      visual_style: analysis?.branding_guidelines?.visual_style,
    },
  };

  /* -----------------------------
     IMAGE GENERATION
  ----------------------------- */
  const generatedImages = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];

    try {
      if (i > 0) {
        // Wait 5 seconds between requests to avoid rate limits
        await new Promise((res) => setTimeout(res, 5000));
      }

      const prompt = buildImagePrompt(image, businessContext);
      const params = {};
      const attachmentUrl = analysis?.branding_guidelines?.logo_url;
      const attachments = attachmentUrl ? [{ path: attachmentUrl }] : [];

      let imageResult = null;
      let attempt = 0;

      // Retry logic per image for 429s
      while (attempt < 3) {
        try {
          imageResult = await generateNanoBanana(
            prompt,
            params,
            userId,
            attachments,
          );
          break;
        } catch (err) {
          attempt++;
          console.warn(
            `[runImageContentGeneration] Image ${i + 1} attempt ${attempt} failed:`,
            err.message,
          );
          if (attempt >= 3) throw err;
          // Exponential backoff
          await new Promise((res) => setTimeout(res, attempt * 5000));
        }
      }

      if (!imageResult || !imageResult.imageBase64) continue;

      let finalBuffer = imageResult.imageBase64;
      let logoUrl = null;

      if (imageResult?.logoSkipped) {
        try {
          logoUrl = await processBusinessBranding(userId);
          if (logoUrl) {
            finalBuffer = await composeImage(
              imageResult.imageBase64,
              logoUrl,
            );
          }
        } catch (error) {
          console.log('Error in logo generation', error)
        }
      }
      const updatedMetaData = await stripCrMetadata(finalBuffer);
      const mediaUrl = await uploadBase64ToS3(updatedMetaData, config.AWS_S3_GENERATE_WITH_LOGO_FOLDER);
      console.log("mediaUrl", mediaUrl);

      const metadata = {
        mimeType: imageResult.mimeType || "image/jpeg",
      };

      const ContentHashtagsRes = await runClaudePostContentGeneration({
        userPrompt: prompt,
        mediaType: "image",
      });

      generatedImages.push({
        mediaUrl,
        description: ContentHashtagsRes?.description,
        hashtags: ContentHashtagsRes.hashtags,
      });
    } catch (err) {
      console.error(
        `[runImageContentGeneration] Failed to generate image ${i + 1}:`,
        err.message,
      );
      // Continue to the next image instead of failing the whole batch
    }
  }

  console.log("generatedImages - ", generatedImages);

  return generatedImages;
}
