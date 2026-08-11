import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

// ─── TOKENS / NUMBERS ──────────────────────────────────────────────

export const getWhatsAppNumbers = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const numbers = await prisma.whatsAppToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ numbers });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const addWhatsAppNumber = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { label, phoneNumberId, wabaId, accessToken, phoneNumber, displayName } = req.body;

    const newNumber = await prisma.whatsAppToken.create({
      data: {
        userId,
        label: label || "New Number",
        phoneNumberId,
        wabaId,
        accessToken,
        phoneNumber,
        displayName,
        status: "active",
      },
    });
    return res.status(201).json({ message: "Number connected successfully", newNumber });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const deleteWhatsAppNumber = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.whatsAppToken.delete({ where: { id } });
    return res.status(200).json({ message: "Number removed successfully" });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── TEMPLATES ─────────────────────────────────────────────────────

export const getTemplates = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const templates = await prisma.whatsAppTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { token: true },
    });
    return res.status(200).json({ templates });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const syncTemplates = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { numberId } = req.body;

    const token = await prisma.whatsAppToken.findUnique({ where: { id: numberId } });
    if (!token) return res.status(404).json({ message: "Number not found" });

    // Call Meta Graph API to fetch templates
    const response = await axios.get(`https://graph.facebook.com/v20.0/${token.wabaId}/message_templates?access_token=${token.accessToken}`);
    const templates = response.data?.data || [];

    // Delete existing templates for this number to refresh
    await prisma.whatsAppTemplate.deleteMany({
      where: { numberId: token.id },
    });

    // Insert new templates
    const newTemplates = templates.map((t: any) => ({
      userId,
      numberId: token.id,
      name: t.name,
      language: t.language,
      category: t.category,
      components: t.components || [],
      status: t.status,
      metaTemplateId: t.id,
      rejectedReason: t.rejected_reason || null,
      qualityScore: t.quality_score?.score || null,
    }));

    if (newTemplates.length > 0) {
      await prisma.whatsAppTemplate.createMany({
        data: newTemplates,
      });
    }

    return res.status(200).json({ message: "Templates synced successfully", count: newTemplates.length });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── CONTACT LISTS ─────────────────────────────────────────────────

export const getContactLists = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const lists = await prisma.whatsAppContactList.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ lists });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const createContactList = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { name, description } = req.body;

    const list = await prisma.whatsAppContactList.create({
      data: { userId, name, description },
    });
    return res.status(201).json({ message: "List created successfully", list });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const uploadContacts = async (req: Request, res: Response) => {
  try {
    const listId = req.params.listId as string;
    const userId = (req as any).user?.id as string;
    // For now we assume req.body.contacts is an array of { phoneNumber, name }
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json({ message: "Contacts array required" });
    }

    const created = await prisma.whatsAppContact.createMany({
      data: contacts.map(c => ({
        userId,
        listId,
        phoneNumber: c.phoneNumber,
        name: c.name || null,
        variables: c.variables || {},
      }))
    });

    await prisma.whatsAppContactList.update({
      where: { id: listId },
      data: { count: { increment: created.count } }
    });

    return res.status(201).json({ message: `${created.count} contacts uploaded successfully` });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── CAMPAIGNS ─────────────────────────────────────────────────────

export const getCampaigns = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const campaigns = await prisma.whatsAppCampaign.findMany({
      where: { userId },
      include: {
        token: true,
        template: true,
        list: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ campaigns });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const createCampaign = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { name, description, numberId, templateId, listId, scheduleAt } = req.body;

    // Get total contacts in list
    const list = await prisma.whatsAppContactList.findUnique({ where: { id: listId } });

    const campaign = await prisma.whatsAppCampaign.create({
      data: {
        userId,
        name,
        description,
        numberId,
        templateId,
        listId,
        scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
        status: "PENDING",
        total: list?.count || 0,
      },
    });
    return res.status(201).json({ message: "Campaign created successfully", campaign });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
