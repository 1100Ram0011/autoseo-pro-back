import { Request, Response } from "express";
import prisma from "../config/prisma";
import { logger } from "../config/logger";

export const createMedia = async (req: Request, res: Response) => {
  try {
    const { userId, chatId, messageId, mediaUrl, mediaType, websiteUrl } = req.body;

    if (!userId || !mediaUrl || !mediaType) {
      return res.status(400).json({ message: "userId, mediaUrl, mediaType are required" });
    }

    if (!["image", "video"].includes(mediaType)) {
      return res.status(400).json({ message: "mediaType must be image or video" });
    }

    const doc = await prisma.mediaStore.create({
      data: {
        userId: String(userId),
        chatId: chatId ? String(chatId) : null,
        messageId: messageId ? String(messageId) : null,
        mediaUrl: String(mediaUrl),
        mediaType: String(mediaType),
        websiteUrl: websiteUrl ? String(websiteUrl) : null,
        isMediaDeleted: false,
      },
    });

    return res.status(201).json({ message: "Media created", data: doc });
  } catch (err: any) {
    logger.error("Error creating media: " + err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const updateMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { mediaUrl, mediaType, chatId, messageId } = req.body;

    if (mediaType && !["image", "video"].includes(mediaType)) {
      return res.status(400).json({ message: "mediaType must be image or video" });
    }

    const dataToUpdate: any = {};
    if (mediaUrl !== undefined) dataToUpdate.mediaUrl = mediaUrl;
    if (mediaType !== undefined) dataToUpdate.mediaType = mediaType;
    if (chatId !== undefined) dataToUpdate.chatId = chatId;
    if (messageId !== undefined) dataToUpdate.messageId = messageId;

    const updated = await prisma.mediaStore.update({
      where: { id: id as string },
      data: dataToUpdate,
    });

    return res.status(200).json({ message: "Media updated", data: updated });
  } catch (err: any) {
    logger.error("Error updating media: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const deleteMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await prisma.mediaStore.update({
      where: { id: id as string },
      data: { isMediaDeleted: true },
    });

    return res.status(200).json({ message: "Media deleted", data: deleted });
  } catch (err: any) {
    logger.error("Error deleting media: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getImagesByUserId = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;

    if (!userId) {
      return res.status(400).json({ message: "Invalid userId or unauthenticated" });
    }

    const data = await prisma.mediaStore.findMany({
      where: {
        userId,
        mediaType: "image",
        isMediaDeleted: false,
        isArchived: false,
        OR: [
          { streamType: { not: "story" } },
          { streamType: null }
        ],
        isUserDeleted: false
      },
      orderBy: { createdAt: "desc" },
    });
    
    return res.status(200).json({ message: "Images fetched", count: data.length, data });
  } catch (err: any) {
    logger.error("Error fetching images: " + err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const restoreMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const restored = await prisma.mediaStore.update({
      where: { id: id as string },
      data: { isMediaDeleted: false, isArchived: false },
    });

    return res.status(200).json({ message: "Media restored", data: restored });
  } catch (err: any) {
    logger.error("Error restoring media: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const permanentlyDeleteMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await prisma.mediaStore.delete({
      where: { id: id as string },
    });

    return res.status(200).json({ message: "Media permanently deleted", data: deleted });
  } catch (err: any) {
    logger.error("Error permanently deleting media: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getDeletedImagesByUserId = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;

    if (!userId) {
      return res.status(400).json({ message: "Invalid userId or unauthenticated" });
    }

    const data = await prisma.mediaStore.findMany({
      where: {
        userId,
        mediaType: "image",
        isMediaDeleted: true,
        isUserDeleted: false,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ message: "Deleted images fetched", count: data.length, data });
  } catch (err: any) {
    logger.error("Error fetching deleted images: " + err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const updateMediaMeta = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { description, hashtags } = req.body;

    if (hashtags !== undefined && !Array.isArray(hashtags)) {
      return res.status(400).json({ message: "hashtags must be an array of strings" });
    }

    const dataToUpdate: any = {};
    if (description !== undefined) dataToUpdate.description = description;

    if (hashtags !== undefined) {
      const formattedHashtags: string[] = [];
      hashtags.forEach((tag: any) => {
        if (typeof tag === "string") {
          formattedHashtags.push(...tag.split(/\s+/).filter(Boolean));
        }
      });
      dataToUpdate.hashtags = JSON.stringify(formattedHashtags);
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const updated = await prisma.mediaStore.update({
      where: { id: id as string },
      data: dataToUpdate,
    });

    return res.status(200).json({ message: "Media meta updated", data: updated });
  } catch (err: any) {
    logger.error("Error updating media meta: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const archiveMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = await prisma.mediaStore.update({
      where: { id: id as string },
      data: { isArchived: true },
    });

    return res.status(200).json({ message: "Media archived", data: updated });
  } catch (err: any) {
    logger.error("Error archiving media: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const unarchiveMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = await prisma.mediaStore.update({
      where: { id: id as string },
      data: { isArchived: false },
    });

    return res.status(200).json({ message: "Media unarchived", data: updated });
  } catch (err: any) {
    logger.error("Error unarchiving media: " + err.message);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: "Media not found" });
    }
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getArchivedMedia = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;

    if (!userId) return res.status(400).json({ message: "Invalid userId or unauthenticated" });

    const data = await prisma.mediaStore.findMany({
      where: {
        userId,
        isArchived: true,
        isUserDeleted: false,
        isMediaDeleted: false,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ message: "Archived media fetched", count: data.length, data });
  } catch (err: any) {
    logger.error("Error fetching archived media: " + err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};
