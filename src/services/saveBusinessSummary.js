import crypto from "crypto";
import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";

export async function saveBusinessSummary({
  userId,
  websiteUrl,
  analysisResponse,
}) {
  const websiteHash = crypto
    .createHash("sha256")
    .update(websiteUrl)
    .digest("hex");

  const confidence =
    analysisResponse?.confidence_levels?.business_analysis_confidence ?? null;

  return BusinessSummaryProfile.findOneAndUpdate(
    { userId, websiteHash, status: "COMPLETED", isActive: true },
    {
      $set: {
        userId,
        websiteUrl,
        websiteHash,
        status: "COMPLETED",
        analysis: analysisResponse,
        confidence,
      },
    },
    { upsert: true, new: true },
  );
}
