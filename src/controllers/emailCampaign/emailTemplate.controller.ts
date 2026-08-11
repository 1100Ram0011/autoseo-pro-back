import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { uploadLocalFile } from "../../utils/localUpload";

const prisma = new PrismaClient();

// Helper to extract {{variable}} placeholders from HTML
function extractVariables(html: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const vars = new Set<string>();
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1]) vars.add(match[1].trim());
  }
  return Array.from(vars);
}

// ==============================
// CREATE TEMPLATE
// ==============================
export const createTemplate = async (req: Request, res: Response) => {
  try {
    const { name, subject, html, design, sourcePrompt, isAIGenerated, sourceAITemplateId } = req.body;
    const userId = (req as any).user?.id;

    if (!name?.trim() || !subject?.trim() || !html?.trim()) {
      return res.status(400).json({ message: "Name, subject, and HTML content are required." });
    }

    // Check for duplicate name
    const existing = await prisma.emailTemplate.findFirst({
      where: { userId, isActive: true, name: name.trim() },
    });
    if (existing) {
      return res.status(409).json({ message: "Template name already exists. Please use a different name." });
    }

    const variables = extractVariables(html);

    // Handle attachments (if multipart upload was handled by middleware, files are in req.files)
    const attachments: any[] = [];
    if ((req as any).files?.length) {
      // In auto-seo-pro, file uploads should be handled via your existing S3/Cloudinary setup
      // Placeholder: store file metadata
      for (const file of (req as any).files) {
        const { url, key } = await uploadLocalFile(file.buffer, file.originalname, "email-attachments");
        attachments.push({
          originalName: file.originalname,
          contentType: file.mimetype,
          size: file.size,
          url,
          key,
        });
      }
    }

    const template = await prisma.emailTemplate.create({
      data: {
        userId,
        name: name.trim(),
        subject: subject.trim(),
        html,
        design: design ?? null,
        variables,
        attachments,
        sourcePrompt: sourcePrompt ?? "",
        isAIGenerated: isAIGenerated ?? false,
        sourceAITemplateId: sourceAITemplateId ?? null,
      },
    });

    return res.status(201).json({ message: "Template created successfully", template });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Template with this name already exists." });
    }
    console.error("Template creation failed:", error.message);
    return res.status(500).json({ message: "Failed to create template" });
  }
};

// ==============================
// UPDATE TEMPLATE
// ==============================
export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const { name, subject, html, design } = req.body;
    const templateId = (req.params.id as string);
    const userId = (req as any).user?.id;

    const template = await prisma.emailTemplate.findFirst({
      where: { id: templateId, userId, isActive: true },
    });
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    const updatedVars = html ? extractVariables(html) : template.variables;

    const updated = await prisma.emailTemplate.update({
      where: { id: templateId },
      data: {
        ...(name && { name }),
        ...(subject && { subject }),
        ...(html && { html, variables: updatedVars }),
        ...(design !== undefined && { design }),
        version: { increment: 1 },
      },
    });

    return res.status(200).json({ message: "Template updated successfully", template: updated });
  } catch (error: any) {
    console.error("Template update failed:", error.message);
    return res.status(500).json({ message: "Failed to update template" });
  }
};

// ==============================
// GET ALL TEMPLATES
// ==============================
export const getTemplates = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const templates = await prisma.emailTemplate.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json(templates);
  } catch (error: any) {
    console.error("Fetch templates failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch templates" });
  }
};

// ==============================
// GET TEMPLATE BY ID
// ==============================
export const getTemplateById = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const template = await prisma.emailTemplate.findFirst({
      where: { id: (req.params.id as string), userId },
    });
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }
    return res.json(template);
  } catch (error: any) {
    console.error("Get template failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch template" });
  }
};

// ==============================
// DELETE TEMPLATE (SOFT DELETE)
// ==============================
export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const template = await prisma.emailTemplate.findFirst({
      where: { id: (req.params.id as string), userId },
    });
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    await prisma.emailTemplate.update({
      where: { id: (req.params.id as string) },
      data: { isActive: false },
    });

    return res.json({ message: "Template deleted successfully" });
  } catch (error: any) {
    console.error("Template deletion failed:", error.message);
    return res.status(500).json({ message: "Failed to delete template" });
  }
};
