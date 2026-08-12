import UserAsset from "../models/UserAsset.js";
import crypto from "crypto";

export const saveUserAsset = async ({
  userId,
  fileBuffer,
  url,
  key,
  mimeType,
  originalName,
  type,
}) => {
  // optional deduplication
  const hash = crypto.createHash("md5").update(fileBuffer).digest("hex");

  const existing = await UserAsset.findOne({
    user: userId,
    hash,
    isDeleted: false,
  });

  if (existing) return existing;

  const asset = await UserAsset.create({
    user: userId,
    url,
    key,
    type,
    mimeType,
    size: fileBuffer.length,
    originalName,
    hash,
  });

  return asset;
};