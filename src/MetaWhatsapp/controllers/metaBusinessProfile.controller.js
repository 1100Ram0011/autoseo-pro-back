import { MetaGraphClient } from "../services/metaFbWhatsapp.client.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import { syncWithMetaGraph } from "../utils/metaSync.util.js";
import logger from "../../config/logger.js";
import config from "../../config/config.js";

const VALID_VERTICALS = [
  "ALCOHOL",
  "APPAREL",
  "AUTO",
  "BEAUTY",
  "EDU",
  "ENTERTAINMENT",
  "EVENT_PLANNING",
  "FINANCE",
  "FOOD_BEV",
  "GROCERY",
  "HOTEL",
  "MEDICAL_HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "NOT_A_BIZ",
  "OTHER",
];

// GET /api/meta/whatsapp/:phoneNumberId/business-profile
export const getBusinessProfile = async (req, res, next) => {
  try {
    const { phoneNumberId } = req.params;
    const credentials = await WhatsAppToken.findOne({
      userId: req.user.id,
      phoneNumberId,
    }).select("+accessToken");

    if (!credentials) {
      return res.status(404).json({
        success: false,
        message: "WhatsApp number not found or unauthorized",
      });
    }

    let configData = credentials.businessProfile || {};

    try {
      await syncWithMetaGraph({
        document: credentials,
        phoneNumberId,
        accessToken: credentials.accessToken,
        fetchFromMetaFn: () =>
          MetaGraphClient.getBusinessProfile(phoneNumberId, credentials.accessToken),
        extractLiveStateFn: (res) => res?.data?.[0],
        compareAndUpdateFn: (doc, profile) => {
          let needsSave = false;
          const currentProfile = doc.businessProfile || {};

          const newProfile = {
            about: profile.about || "",
            address: profile.address || "",
            description: profile.description || "",
            email: profile.email || "",
            profile_picture_url: profile.profile_picture_url || "",
            websites: profile.websites || [],
            vertical: profile.vertical || "",
            lastSyncedAt: new Date(),
          };

          if (
            currentProfile.about !== newProfile.about ||
            currentProfile.address !== newProfile.address ||
            currentProfile.description !== newProfile.description ||
            currentProfile.email !== newProfile.email ||
            currentProfile.profile_picture_url !== newProfile.profile_picture_url ||
            currentProfile.vertical !== newProfile.vertical ||
            JSON.stringify(currentProfile.websites || []) !== JSON.stringify(newProfile.websites)
          ) {
            doc.businessProfile = newProfile;
            needsSave = true;
          }

          return needsSave;
        },
      });

      configData = credentials.businessProfile || {};
    } catch (metaErr) {
      logger.warn(
        `[Business Profile] Could not fetch from Meta, using local DB config for ${phoneNumberId}: ${metaErr.message}`,
      );
    }

    return res.json({ success: true, data: configData });
  } catch (err) {
    logger.error(
      `[Business Profile] Get error for ${req.params.phoneNumberId}:`,
      err.message,
    );
    next(err);
  }
};

// POST /api/meta/whatsapp/:phoneNumberId/business-profile
export const updateBusinessProfile = async (req, res, next) => {
  try {
    const { phoneNumberId } = req.params;
    const { about, address, description, email, websites, vertical } = req.body;

    const credentials = await WhatsAppToken.findOne({
      userId: req.user.id,
      phoneNumberId,
    }).select("+accessToken");

    if (!credentials) {
      return res.status(404).json({
        success: false,
        message: "WhatsApp number not found or unauthorized",
      });
    }

    // Validation
    if (about && about.length > 139)
      return res.status(400).json({
        success: false,
        message: "About text exceeds 139 characters.",
      });
    if (address && address.length > 256)
      return res
        .status(400)
        .json({ success: false, message: "Address exceeds 256 characters." });
    if (description && description.length > 512)
      return res.status(400).json({
        success: false,
        message: "Description exceeds 512 characters.",
      });

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email))
        return res
          .status(400)
          .json({ success: false, message: "Invalid email format." });
    }

    if (websites) {
      if (!Array.isArray(websites))
        return res
          .status(400)
          .json({ success: false, message: "Websites must be an array." });
      if (websites.length > 2)
        return res
          .status(400)
          .json({ success: false, message: "Maximum of 2 websites allowed." });
      for (const url of websites) {
        if (url.length > 256)
          return res.status(400).json({
            success: false,
            message: "Website URL exceeds 256 characters.",
          });
      }
    }

    if (vertical && !VALID_VERTICALS.includes(vertical) && vertical !== "") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid industry vertical." });
    }

    const profileData = {};
    
    // Meta API crashes with 500 error if string fields are sent as an empty string (""). 
    // We convert "" to " " so Meta accepts it and it appears visually clear to the user.
    if (about !== undefined) {
      profileData.about = about.trim() === "" ? " " : about;
    }
    if (address !== undefined) {
      profileData.address = address.trim() === "" ? " " : address;
    }
    if (description !== undefined) {
      profileData.description = description.trim() === "" ? " " : description;
    }
    if (email !== undefined) {
      profileData.email = email.trim() === "" ? " " : email;
    }
    if (websites !== undefined) {
      profileData.websites = websites.filter(w => w.trim() !== "");
    }
    if (vertical !== undefined) {
      profileData.vertical = vertical.trim() === "" ? "OTHER" : vertical;
    }

    try {
      await MetaGraphClient.updateBusinessProfile(
        phoneNumberId,
        profileData,
        credentials.accessToken,
      );
    } catch (metaErr) {
      console.error("Meta API Error Details:", metaErr.message, metaErr);
      return res.status(400).json({
        success: false,
        message:
          metaErr.metaUserMsg ||
          metaErr.message ||
          "Failed to update profile on Meta.",
      });
    }

    // Update local DB
    const updatedBusinessProfile = {
      ...(credentials.businessProfile
        ? credentials.businessProfile.toObject()
        : {}),
      ...profileData,
      lastSyncedAt: new Date(),
    };

    await WhatsAppToken.updateOne(
      { phoneNumberId },
      { $set: { businessProfile: updatedBusinessProfile } },
    );

    return res.json({
      success: true,
      message: "Business profile updated",
      data: updatedBusinessProfile,
    });
  } catch (err) {
    logger.error(
      `[Business Profile] Update error for ${req.params.phoneNumberId}:`,
      err.message,
    );
    next(err);
  }
};

// POST /api/meta/whatsapp/:phoneNumberId/business-profile/photo
export const uploadProfilePhoto = async (req, res, next) => {
  try {
    const { phoneNumberId } = req.params;
    const file = req.file;

    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "No image file provided." });
    }

    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Only JPEG or PNG images are allowed.",
      });
    }

    const credentials = await WhatsAppToken.findOne({
      userId: req.user.id,
      phoneNumberId,
    }).select("+accessToken +appId");

    if (!credentials) {
      return res.status(404).json({
        success: false,
        message: "WhatsApp number not found or unauthorized",
      });
    }

    const accessToken = credentials.accessToken;
    const appId = credentials.appId || config.META_WHATSAPP_APP_ID;

    // Step 1: Create Upload Session
    let sessionId;
    try {
      const sessionData = await MetaGraphClient.createUploadSession(
        appId,
        accessToken,
        file.size,
        file.mimetype,
        file.originalname,
      );
      sessionId = sessionData.id;
    } catch (err) {
      logger.error(`[Profile Photo] Step 1 failed: ${err.message}`);
      return res.status(500).json({
        success: false,
        message: "Failed to create upload session with Meta",
        error: err.message,
      });
    }

    // Step 2: Upload Binary Data
    let handle;
    try {
      const uploadData = await MetaGraphClient.uploadFileData(
        sessionId,
        file.buffer,
        file.mimetype,
        accessToken,
      );
      handle = uploadData.h;
    } catch (err) {
      logger.error(`[Profile Photo] Step 2 failed: ${err.message}`);
      return res.status(500).json({
        success: false,
        message: "Failed to upload image to Meta",
        error: err.message,
      });
    }

    // Step 3: Set Profile Picture
    try {
      await MetaGraphClient.updateBusinessProfile(
        phoneNumberId,
        { profile_picture_handle: handle },
        accessToken,
      );
    } catch (err) {
      logger.error(`[Profile Photo] Step 3 failed: ${err.message}`);
      return res.status(500).json({
        success: false,
        message: "Image uploaded but failed to set as profile picture",
        error: err.message,
      });
    }

    // Fetch latest profile to get the URL
    let newUrl = "";
    try {
      const profile = await MetaGraphClient.getBusinessProfile(
        phoneNumberId,
        accessToken,
      );
      newUrl = profile?.profile_picture_url || "";

      await WhatsAppToken.updateOne(
        { phoneNumberId },
        {
          $set: {
            "businessProfile.profile_picture_url": newUrl,
            "businessProfile.lastSyncedAt": new Date(),
          },
        },
      );
    } catch (err) {
      logger.warn(
        `[Profile Photo] Failed to fetch updated profile URL: ${err.message}`,
      );
    }

    return res.json({
      success: true,
      profile_picture_url: newUrl,
      message: "Profile photo updated successfully.",
    });
  } catch (err) {
    logger.error(
      `[Profile Photo] Error for ${req.params.phoneNumberId}:`,
      err.message,
    );
    next(err);
  }
};
