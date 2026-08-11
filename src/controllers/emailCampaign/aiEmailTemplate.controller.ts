import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

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

// ============================================================
// ADMIN: CREATE AI TEMPLATE
// ============================================================
export const createAITemplate = async (req: Request, res: Response) => {
  try {
    const { name, subject, html, design, prompt, category, description, thumbnailUrl, tags, isFeatured } = req.body;
    const userId = (req as any).user?.id;

    if (!name?.trim() || !subject?.trim() || !html?.trim()) {
      return res.status(400).json({ message: "Name, subject, and HTML content are required." });
    }

    const existing = await prisma.aIEmailTemplate.findFirst({
      where: { name: name.trim(), isActive: true },
    });
    if (existing) {
      return res.status(409).json({ message: "An AI template with this name already exists." });
    }

    const variables = extractVariables(html);

    const template = await prisma.aIEmailTemplate.create({
      data: {
        name: name.trim(),
        subject: subject.trim(),
        html,
        design: design ?? "",
        prompt: prompt?.trim() ?? "",
        category: category ?? "General",
        description: description?.trim() ?? "",
        thumbnailUrl: thumbnailUrl ?? "",
        variables,
        tags: Array.isArray(tags) ? tags : [],
        isFeatured: !!isFeatured,
        createdById: userId,
      },
    });

    return res.status(201).json({ message: "AI template created successfully", template });
  } catch (error: any) {
    console.error("AI template creation failed:", error.message);
    return res.status(500).json({ message: "Failed to create AI template" });
  }
};

// ============================================================
// ADMIN: UPDATE AI TEMPLATE
// ============================================================
export const updateAITemplate = async (req: Request, res: Response) => {
  try {
    const { name, subject, html, design, prompt, category, description, thumbnailUrl, tags, isFeatured } = req.body;

    const existing = await prisma.aIEmailTemplate.findUnique({ where: { id: (req.params.id as string) } });
    if (!existing || !existing.isActive) {
      return res.status(404).json({ message: "AI template not found." });
    }

    const variables = html ? extractVariables(html) : existing.variables;

    const updated = await prisma.aIEmailTemplate.update({
      where: { id: (req.params.id as string) },
      data: {
        ...(name && { name: name.trim() }),
        ...(subject && { subject: subject.trim() }),
        ...(html && { html, variables }),
        ...(design !== undefined && { design }),
        ...(prompt !== undefined && { prompt }),
        ...(category && { category }),
        ...(description !== undefined && { description }),
        ...(thumbnailUrl !== undefined && { thumbnailUrl }),
        ...(tags && { tags: Array.isArray(tags) ? tags : [] }),
        ...(isFeatured !== undefined && { isFeatured: !!isFeatured }),
        version: { increment: 1 },
      },
    });

    return res.json({ message: "AI template updated successfully", template: updated });
  } catch (error: any) {
    console.error("AI template update failed:", error.message);
    return res.status(500).json({ message: "Failed to update AI template" });
  }
};

// ============================================================
// PUBLIC/USER: GET AI TEMPLATES
// ============================================================
export const getAITemplates = async (req: Request, res: Response) => {
  try {
    const { category, featured, search } = req.query;
    const where: any = { isActive: true };

    if (category && category !== "all") where.category = category;
    if (featured === "true") where.isFeatured = true;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { description: { contains: search as string, mode: "insensitive" } },
        { tags: { has: search as string } },
      ];
    }

    const templates = await prisma.aIEmailTemplate.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { usageCount: "desc" }, { createdAt: "desc" }],
    });

    return res.json(templates);
  } catch (error: any) {
    console.error("Get AI templates failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch AI templates" });
  }
};

// ============================================================
// USER: USE AI TEMPLATE (copy to user's own templates)
// ============================================================
export const useAITemplate = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const aiTemplate = await prisma.aIEmailTemplate.findUnique({ where: { id: (req.params.id as string) } });
    if (!aiTemplate || !aiTemplate.isActive) {
      return res.status(404).json({ message: "AI template not found." });
    }

    const userTemplate = await prisma.emailTemplate.create({
      data: {
        userId,
        name: aiTemplate.name,
        subject: aiTemplate.subject,
        html: aiTemplate.html,
        design: aiTemplate.design,
        variables: aiTemplate.variables,
        attachments: [],
        sourcePrompt: aiTemplate.prompt,
        isAIGenerated: true,
        sourceAITemplateId: aiTemplate.id,
      },
    });

    // Increment usage count
    await prisma.aIEmailTemplate.update({
      where: { id: (req.params.id as string) },
      data: { usageCount: { increment: 1 } },
    });

    return res.status(201).json({ message: "Template copied to your library", template: userTemplate });
  } catch (error: any) {
    console.error("Use AI template failed:", error.message);
    return res.status(500).json({ message: "Failed to use AI template" });
  }
};

// ============================================================
// ADMIN: DELETE AI TEMPLATE (soft)
// ============================================================
export const deleteAITemplate = async (req: Request, res: Response) => {
  try {
    const template = await prisma.aIEmailTemplate.findUnique({ where: { id: (req.params.id as string) } });
    if (!template) {
      return res.status(404).json({ message: "AI template not found." });
    }

    await prisma.aIEmailTemplate.update({
      where: { id: (req.params.id as string) },
      data: { isActive: false },
    });

    return res.json({ message: "AI template deleted successfully" });
  } catch (error: any) {
    console.error("Delete AI template failed:", error.message);
    return res.status(500).json({ message: "Failed to delete AI template" });
  }
};
