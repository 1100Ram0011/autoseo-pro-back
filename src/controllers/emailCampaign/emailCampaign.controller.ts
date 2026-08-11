import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { parseExcel } from "../../utils/parseExcel";
import { uploadToS3 } from "../../services/upload.service";

const prisma = new PrismaClient();

// ==============================
// GET CAMPAIGNS (with pagination)
// ==============================
export const getCampaigns = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      prisma.emailCampaign.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          template: {
            select: { id: true, name: true, subject: true },
          },
        },
      }),
      prisma.emailCampaign.count({ where: { userId } }),
    ]);

    return res.json({
      campaigns,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (error: any) {
    console.error("Get campaigns failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch campaigns" });
  }
};

// ==============================
// GET CAMPAIGN BY ID
// ==============================
export const getCampaignById = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const campaign = await prisma.emailCampaign.findFirst({
      where: { id: (req.params.id as string), userId },
      include: { template: true },
    });
    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }
    return res.json(campaign);
  } catch (error: any) {
    console.error("Get campaign failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch campaign" });
  }
};

// ==============================
// CREATE CAMPAIGN
// ==============================
export const createCampaign = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const {
      name,
      templateId,
      provider,
      senderEmail,
      campaignMail,
      companyName,
      companyAddress,
    } = req.body;

    if (!name || !templateId || !provider) {
      return res.status(400).json({ message: "name, templateId, and provider are required." });
    }

    // Validate template exists and belongs to user
    const template = await prisma.emailTemplate.findFirst({
      where: { id: templateId, userId, isActive: true },
    });
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Check duplicate campaign name
    const existing = await prisma.emailCampaign.findFirst({
      where: { userId, name },
    });
    if (existing) {
      return res.status(409).json({ message: `Campaign name "${name}" already exists.` });
    }

    // Handle Excel file upload if provided
    let excelFileUrl: string | undefined;
    let excelFileKey: string | undefined;
    let totalRecipients = 0;
    let parsedRecipients: any[] = [];

    if ((req as any).file) {
      const file = (req as any).file;
      try {
        // 1. Parse Excel/CSV to rows
        parsedRecipients = parseExcel(file.buffer);
        totalRecipients = parsedRecipients.length;

        // 2. Upload original file to S3 for backup
        const s3Key = `campaign-recipients/${userId}/${Date.now()}-${file.originalname}`;
        const s3Url = await uploadToS3(
          file.buffer,
          s3Key,
          "campaign-recipients",
          file.mimetype
        );
        excelFileUrl = s3Url;
        excelFileKey = s3Key;
      } catch (parseError: any) {
        return res.status(400).json({ message: parseError.message || "Failed to parse Excel file" });
      }
    }

    const campaign = await prisma.emailCampaign.create({
      data: {
        name,
        userId,
        provider,
        templateId,
        senderEmail: senderEmail ?? null,
        campaignMail: campaignMail ?? null,
        companyName: companyName ?? null,
        companyAddress: companyAddress ?? null,
        excelFileUrl: excelFileUrl ?? null,
        excelFileKey: excelFileKey ?? null,
        totalRecipients,
        status: "pending",
      },
    });

    // 3. Bulk create recipient log records
    if (parsedRecipients.length > 0) {
      const logData = parsedRecipients.map((row) => ({
        campaignId: campaign.id,
        senderUserId: userId,
        recipientEmail: row.email,
        recipientName: row.name ?? null,
        companyName: row.company ?? null,
        dataFile: row,
        status: "queued",
      }));

      await prisma.campaignRecipientLog.createMany({ data: logData });
    }

    return res.status(201).json({ message: "Campaign created successfully", campaign });
  } catch (error: any) {
    console.error("Create campaign failed:", error.message);
    return res.status(500).json({ message: "Failed to create campaign" });
  }
};

// ==============================
// UPDATE CAMPAIGN STATUS
// ==============================
export const updateCampaignStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { status, holdReason, resumeAt } = req.body;
    const allowedStatuses = ["paused", "stopped", "pending"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(", ")}` });
    }

    const campaign = await prisma.emailCampaign.findFirst({
      where: { id: (req.params.id as string), userId },
    });
    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    const updated = await prisma.emailCampaign.update({
      where: { id: (req.params.id as string) },
      data: {
        status,
        holdReason: holdReason ?? null,
        resumeAt: resumeAt ? new Date(resumeAt) : null,
      },
    });

    return res.json({ message: "Campaign status updated", campaign: updated });
  } catch (error: any) {
    console.error("Update campaign status failed:", error.message);
    return res.status(500).json({ message: "Failed to update campaign" });
  }
};

// ==============================
// DELETE CAMPAIGN
// ==============================
export const deleteCampaign = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const campaign = await prisma.emailCampaign.findFirst({
      where: { id: (req.params.id as string), userId },
    });
    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    // Delete recipient logs first (cascade should handle this, but explicit is safer)
    await prisma.campaignRecipientLog.deleteMany({ where: { campaignId: (req.params.id as string) } });
    await prisma.emailCampaign.delete({ where: { id: (req.params.id as string) } });

    return res.json({ message: "Campaign deleted successfully" });
  } catch (error: any) {
    console.error("Delete campaign failed:", error.message);
    return res.status(500).json({ message: "Failed to delete campaign" });
  }
};

// ==============================
// GET CAMPAIGN LOGS (Recipient log)
// ==============================
export const getCampaignLogs = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const campaign = await prisma.emailCampaign.findFirst({
      where: { id: (req.params.id as string), userId },
    });
    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    const where: any = { campaignId: (req.params.id as string) };
    if (status) where.status = status;

    const [logs, total] = await Promise.all([
      prisma.campaignRecipientLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.campaignRecipientLog.count({ where }),
    ]);

    return res.json({
      logs,
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
    });
  } catch (error: any) {
    console.error("Get campaign logs failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch campaign logs" });
  }
};

// ==============================
// EMAIL OPEN TRACKING PIXEL
// ==============================
export const trackEmailOpen = async (req: Request, res: Response) => {
  try {
    const { logId } = req.params;

    await prisma.campaignRecipientLog.updateMany({
      where: { id: logId as string, openedAt: null },
      data: { openedAt: new Date(), status: "delivered" },
    });

    // Increment campaign openedCount
    const log = await prisma.campaignRecipientLog.findUnique({ where: { id: logId as string } });
    if (log) {
      await prisma.emailCampaign.update({
        where: { id: log.campaignId },
        data: { openedCount: { increment: 1 } },
      });
    }

    // Return 1x1 transparent GIF
    const pixel = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    res.set({ "Content-Type": "image/gif", "Cache-Control": "no-cache, no-store" });
    return res.send(pixel);
  } catch (error: any) {
    // Don't fail tracking — silently return pixel
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.set("Content-Type", "image/gif");
    return res.send(pixel);
  }
};

// ==============================
// CLICK TRACKING REDIRECT
// ==============================
export const trackEmailClick = async (req: Request, res: Response) => {
  try {
    const { logId } = req.params;
    const redirectUrl = req.query.url as string;

    await prisma.campaignRecipientLog.updateMany({
      where: { id: logId as string, clickedAt: null },
      data: { clickedAt: new Date() },
    });

    const log = await prisma.campaignRecipientLog.findUnique({ where: { id: logId as string } });
    if (log) {
      await prisma.emailCampaign.update({
        where: { id: log.campaignId },
        data: { clickedCount: { increment: 1 } },
      });
    }

    if (redirectUrl) {
      return res.redirect(decodeURIComponent(redirectUrl));
    }
    return res.json({ message: "Click tracked" });
  } catch (error: any) {
    const redirectUrl = req.query.url as string;
    if (redirectUrl) return res.redirect(decodeURIComponent(redirectUrl));
    return res.json({ message: "Click tracked" });
  }
};
